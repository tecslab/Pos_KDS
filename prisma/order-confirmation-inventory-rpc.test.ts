import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260825110000_consume_resale_inventory_on_order_confirmation/migration.sql",
  import.meta.url,
);
const probePath = new URL(
  "./probes/T-038-order-confirmation-resale-inventory-probes.sql",
  import.meta.url,
);

describe("order confirmation resale inventory consumption", () => {
  it("replaces the existing service-role-only atomic confirmation boundary", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.confirm_order(");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.confirm_order\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.confirm_order\([\s\S]+TO service_role/,
    );
    for (const table of [
      "orders",
      "customer_baskets",
      "order_lines",
      "order_line_sale_snapshots",
      "inventory_movements",
      "audit_events",
    ]) {
      expect(sql).toMatch(new RegExp(`INSERT INTO public\\.${table}`));
    }
  });

  it("consumes only linked resale sources and aggregates them by inventory item", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("version.resale_inventory_item_id");
    expect(sql).toContain("line.resale_inventory_item_id IS NOT NULL");
    expect(sql).toContain("GROUP BY item.id, item.unit_of_measure");
    expect(sql).toContain(
      "array_agg(line.snapshot_id ORDER BY line.snapshot_id)",
    );
    expect(sql).toContain("item.type IS DISTINCT FROM 'RESALE_ITEM'");
    expect(sql).toContain("OR NOT item.is_active");
    expect(sql).toContain("OR item.deleted_at IS NOT NULL");
    expect(sql).not.toMatch(
      /RAW_INGREDIENT|PRODUCTION_CONSUMPTION|recipe_ingredients/,
    );
  });

  it("locks resale items deterministically and records canonical sale movements", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(
      /JOIN pg_temp\.order_confirmation_resale_movements[\s\S]+ORDER BY item\.id[\s\S]+FOR UPDATE OF item/,
    );
    expect(sql).toMatch(
      /INSERT INTO public\.inventory_movements[\s\S]+-resale_movement\.quantity::numeric\(14, 3\)[\s\S]+'SALE'[\s\S]+order_id_to_insert/,
    );
    expect(sql).toContain("resale_movement.unit_of_measure");
    expect(sql).toContain("actor_user_id");
    expect(sql).toContain("confirmation_time");
    expect(sql).not.toMatch(/UPDATE public\.inventory_movements/i);
    expect(sql).not.toMatch(/DELETE FROM public\.inventory_movements/i);
  });

  it("translates only the ledger negative-balance violation", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("EXCEPTION WHEN check_violation THEN");
    expect(sql).toContain(
      "GET STACKED DIAGNOSTICS inventory_error_message = MESSAGE_TEXT",
    );
    expect(sql).toContain(
      "inventory_error_message = 'inventory movement would produce a negative balance'",
    );
    expect(sql).toContain("ORDER_CONFIRMATION_INSUFFICIENT_INVENTORY");
    expect(sql).toMatch(/END IF;\s+RAISE;\s+END;/);
  });

  it("audits every movement with its persisted fields and snapshot provenance", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("'inventory_movement.sale_recorded'");
    expect(sql).toContain("'inventory_movement'");
    for (const field of [
      "inventoryMovementId",
      "restaurantId",
      "inventoryItemId",
      "quantityDelta",
      "unitOfMeasure",
      "recordedById",
      "recordedAt",
      "businessOriginType",
      "businessOriginId",
      "saleSnapshotIds",
    ]) {
      expect(sql).toContain(`'${field}'`);
    }
    expect(sql).toContain("'order.confirmed'");
  });

  it("ships a rollback-only transaction probe for aggregation and both stock policies", async () => {
    const probe = await readFile(probePath, "utf8");
    expect(probe).toMatch(/^BEGIN;/);
    expect(probe).toMatch(/ROLLBACK;\s*$/);
    expect(probe).toContain("quantity_delta = -5");
    expect(probe).toContain(
      "jsonb_array_length(audit.new_values -> 'saleSnapshotIds') = 2",
    );
    expect(probe).toContain("ORDER_CONFIRMATION_INSUFFICIENT_INVENTORY");
    expect(probe).toContain("rejected confirmation persisted partial state");
    expect(probe).toContain("'{allowNegativeStock}', 'true'::jsonb");
    expect(probe).toContain("current_balance");
    expect(probe).toContain("<> -1");
  });
});
