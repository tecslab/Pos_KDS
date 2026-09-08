import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260907090000_register_inventory_adjustments_and_waste_atomically/migration.sql",
  import.meta.url,
);
const schemaPath = new URL("./schema.prisma", import.meta.url);
const probePath = new URL(
  "./probes/T-060-inventory-adjustment-waste-registration-probes.sql",
  import.meta.url,
);

describe("inventory adjustment and waste persistence", () => {
  it("models immutable adjustment and waste origins linked to movements", async () => {
    const [schema, sql] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(migrationPath, "utf8"),
    ]);
    expect(schema).toContain("model InventoryAdjustment");
    expect(schema).toContain("model InventoryWasteRecord");
    expect(sql).toContain("CREATE TABLE public.inventory_adjustments");
    expect(sql).toContain("CREATE TABLE public.inventory_waste_records");
    expect(sql).toContain("inventory_adjustments_movement_fkey");
    expect(sql).toContain("inventory_waste_records_movement_fkey");
    expect(sql.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(5);
    expect(sql).toContain(
      "BEFORE UPDATE OR DELETE ON public.inventory_adjustments",
    );
    expect(sql).toContain(
      "BEFORE UPDATE OR DELETE ON public.inventory_waste_records",
    );
  });

  it("enforces exact, exclusive movement provenance at deferred commit", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const invariant of [
      "movement_count <> 1",
      "inventory adjustment movement origin is not exclusive",
      "inventory waste movement origin is not exclusive",
      "movement.quantity_delta = adjustment_record.quantity_delta",
      "movement.quantity_delta = -waste_record.quantity",
      "movement.comments = adjustment_record.reason",
      "movement.comments = waste_record.reason",
      "movement.reversed_movement_id IS NULL",
    ]) {
      expect(sql).toContain(invariant);
    }
    expect(sql.match(/CREATE CONSTRAINT TRIGGER/g)).toHaveLength(3);
  });

  it("implements one service-role-only RPC with permission separation and stock validation", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "CREATE FUNCTION public.register_inventory_adjustment_or_waste(",
    );
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toContain("'inventory.adjustments.register'");
    expect(sql).toContain("'inventory.waste.register'");
    expect(sql).toContain("application_user.is_active");
    expect(sql).toContain("inventory_policy ->> 'allowNegativeStock'");
    expect(sql).toContain("INVENTORY_MOVEMENT_NEGATIVE_STOCK_DISALLOWED");
    for (const table of [
      "inventory_adjustments",
      "inventory_waste_records",
      "inventory_movements",
      "audit_events",
    ]) {
      expect(sql).toMatch(new RegExp(`INSERT INTO public\\.${table}`));
    }
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.register_inventory_adjustment_or_waste\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.register_inventory_adjustment_or_waste\([\s\S]+TO service_role/,
    );
  });

  it("audits actor, reason, timestamp, provenance, and old/new balances", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const key of [
      "originId",
      "inventoryMovementId",
      "restaurantId",
      "inventoryItemId",
      "quantityDelta",
      "unitOfMeasure",
      "reason",
      "recordedById",
      "recordedAt",
      "balance",
    ]) {
      expect(sql).toContain(`'${key}'`);
    }
    expect(sql).toContain("source_ip_value");
  });

  it("ships rollback-only probes for authorization, tenancy, stock policy, integrity, and atomicity", async () => {
    const probe = await readFile(probePath, "utf8");
    expect(probe).toMatch(/^BEGIN;/);
    expect(probe).toMatch(/ROLLBACK;\s*$/);
    for (const evidence of [
      "adjustment did not create exact atomic records",
      "waste did not create exact atomic records",
      "permission split was not enforced",
      "negative stock was accepted when disabled",
      "negative stock was rejected when enabled",
      "cross-tenant item was accepted",
      "inactive item was accepted",
      "missing item was accepted",
      "inventory_adjustments history is immutable",
      "inventory_waste_records history is immutable",
      "additional adjustment-origin movement was accepted",
      "forced audit failure left partial records",
    ]) {
      expect(probe).toContain(evidence);
    }
  });
});
