import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260829110000_reconcile_resale_inventory_on_order_modification/migration.sql",
  import.meta.url,
);
const probePath = new URL(
  "./probes/T-079-order-modification-resale-inventory-probes.sql",
  import.meta.url,
);

describe("pending-order resale inventory reconciliation", () => {
  it("retains one service-only atomic RPC while hiding its order-only helper", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("RENAME TO modify_pending_order_without_inventory");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.modify_pending_order_without_inventory\([\s\S]+service_role/,
    );
    expect(sql).toContain("CREATE FUNCTION public.modify_pending_order(");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.modify_pending_order\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.modify_pending_order\([\s\S]+TO service_role/,
    );
  });

  it("aggregates before and after active resale snapshots and excludes recipes", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("pg_temp.t079_resale_before");
    expect(sql).toContain("pg_temp.t079_resale_after");
    expect(sql).toContain("product_version.resale_inventory_item_id");
    expect(sql).toContain("FULL JOIN pg_temp.t079_resale_after");
    expect(sql).toContain("sum(snapshot.quantity)");
    expect(sql).not.toMatch(/recipe_ingredients|PRODUCTION_CONSUMPTION/);
  });

  it("locks affected items and enforces active resale sources only for new consumption", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(
      /JOIN pg_temp\.t079_resale_deltas[\s\S]+ORDER BY inventory_item\.id[\s\S]+FOR UPDATE OF inventory_item/,
    );
    expect(sql).toContain("inventory_item.type IS DISTINCT FROM 'RESALE_ITEM'");
    expect(sql).toMatch(
      /delta\.quantity_delta > 0[\s\S]+NOT inventory_item\.is_active[\s\S]+inventory_item\.deleted_at IS NOT NULL/,
    );
  });

  it("appends net sales and provenance-linked compensations without mutating history", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("'SALE'");
    expect(sql).toContain("-resale_delta.quantity_delta::numeric(14, 3)");
    expect(sql).toContain("'ROLLBACK'");
    expect(sql).toContain("source_sale.id");
    expect(sql).toContain("sale.business_origin_id = target_order_id");
    expect(sql).not.toMatch(/UPDATE public\.inventory_movements/i);
    expect(sql).not.toMatch(/DELETE FROM public\.inventory_movements/i);
  });

  it("supports bounded multipart reversals and rejects cumulative over-reversal", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "DROP INDEX public.inventory_movements_one_reversal_idx",
    );
    expect(sql).toContain("already_reversed_quantity");
    expect(sql).toContain(
      "abs(already_reversed_quantity + NEW.quantity_delta) > abs(reversed_quantity)",
    );
    expect(sql).toContain(
      "rollback movements cannot cumulatively exceed the referenced movement",
    );
    expect(sql).toContain("remaining_to_restore");
    expect(sql).toContain("ORDER BY sale.recorded_at, sale.id");
  });

  it("maps stock failure, audits snapshot provenance, and returns movement summaries", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("ORDER_MODIFICATION_INSUFFICIENT_INVENTORY");
    expect(sql).toContain(
      "inventory_error_message = 'inventory movement would produce a negative balance'",
    );
    expect(sql).toContain("'inventory_movement.sale_recorded'");
    expect(sql).toContain("'inventory_movement.rollback_recorded'");
    expect(sql).toContain("'previousSnapshotQuantities'");
    expect(sql).toContain("'newSnapshotQuantities'");
    expect(sql).toContain("inventory_movements jsonb");
  });

  it("ships a rollback-only behavior probe for reconciliation and atomic rejection", async () => {
    const probe = await readFile(probePath, "utf8");
    expect(probe).toMatch(/^BEGIN;/);
    expect(probe).toMatch(/ROLLBACK;\s*$/);
    expect(probe).toContain("increase did not append one aggregated sale");
    expect(probe).toContain(
      "partial reduction did not append a linked rollback",
    );
    expect(probe).toContain(
      "removal did not restore the remaining sale quantity",
    );
    expect(probe).toContain("non-resale modification changed inventory");
    expect(probe).toContain("ORDER_MODIFICATION_INSUFFICIENT_INVENTORY");
    expect(probe).toContain(
      "insufficient-stock modification persisted partial state",
    );
  });
});
