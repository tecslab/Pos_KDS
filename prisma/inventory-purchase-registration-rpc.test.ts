import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260906090000_register_inventory_purchases_atomically/migration.sql",
  import.meta.url,
);
const schemaPath = new URL("./schema.prisma", import.meta.url);
const triggerFixPath = new URL(
  "./migrations/20260906091000_fix_inventory_purchase_integrity_trigger/migration.sql",
  import.meta.url,
);
const exclusivityFixPath = new URL(
  "./migrations/20260906100000_enforce_inventory_purchase_origin_exclusivity/migration.sql",
  import.meta.url,
);
const probePath = new URL(
  "./probes/T-058-inventory-purchase-registration-probes.sql",
  import.meta.url,
);

describe("inventory purchase registration persistence", () => {
  it("models immutable purchase headers and origin-linked lines", async () => {
    const [schema, sql] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(migrationPath, "utf8"),
    ]);
    expect(schema).toContain("model InventoryPurchase");
    expect(schema).toContain("model InventoryPurchaseLine");
    expect(sql).toContain("CREATE TABLE public.inventory_purchases");
    expect(sql).toContain("CREATE TABLE public.inventory_purchase_lines");
    expect(sql).toContain("inventory_purchases_expense_fkey");
    expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(sql).toContain("inventory_purchase_lines_movement_fkey");
    expect(sql).toContain("inventory_purchase_lines_total_exact");
    expect(sql).toContain(
      "BEFORE UPDATE OR DELETE ON public.inventory_purchases",
    );
    expect(sql).toContain(
      "BEFORE UPDATE OR DELETE ON public.inventory_purchase_lines",
    );
  });

  it("enforces complete matching movements and expense at deferred commit", async () => {
    const [sql, triggerFix, exclusivityFix] = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(triggerFixPath, "utf8"),
      readFile(exclusivityFixPath, "utf8"),
    ]);
    expect(sql).toContain(
      "CREATE FUNCTION public.assert_inventory_purchase_integrity",
    );
    expect(sql).toContain("line_total_sum <> purchase_record.total_amount");
    for (const field of [
      "movement.type IS DISTINCT FROM 'PURCHASE'",
      "movement.quantity_delta IS DISTINCT FROM line.quantity",
      "movement.business_origin_id IS DISTINCT FROM purchase_record.id",
      "expense.amount = purchase_record.total_amount",
      "expense.origin_type = 'PURCHASE'",
      "expense.origin_id = purchase_record.id",
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql.match(/CREATE CONSTRAINT TRIGGER/g)).toHaveLength(4);
    expect(triggerFix).toContain(
      "CREATE OR REPLACE FUNCTION public.check_inventory_purchase_integrity_deferred()",
    );
    expect(triggerFix).toMatch(
      /ELSIF TG_TABLE_NAME = 'inventory_movements' THEN\s+IF NEW\.business_origin_type = 'PURCHASE'/,
    );
    for (const invariant of [
      "movement_count <> line_count",
      "inventory purchase movement origin is not exclusive",
      "expense_count <> 1",
      "inventory purchase expense origin is not exclusive",
    ]) {
      expect(sql).toContain(invariant);
      expect(exclusivityFix).toContain(invariant);
    }
  });

  it("implements one service-role-only authorized atomic RPC", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "CREATE FUNCTION public.register_inventory_purchase(",
    );
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toContain("permission.code = 'inventory.purchases.register'");
    expect(sql).toContain("application_user.is_active");
    for (const table of [
      "inventory_purchases",
      "inventory_movements",
      "inventory_purchase_lines",
      "operating_expenses",
      "audit_events",
    ]) {
      expect(sql).toMatch(new RegExp(`INSERT INTO public\\.${table}`));
    }
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.register_inventory_purchase\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.register_inventory_purchase\([\s\S]+TO service_role/,
    );
  });

  it("validates tenant-scoped active items and category and audits exact provenance", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("category.restaurant_id = target_restaurant_id");
    expect(sql).toContain("category.is_active");
    expect(sql).toContain("item.restaurant_id = target_restaurant_id");
    expect(sql).toContain("item.is_active");
    expect(sql).toContain("'inventory_purchase.registered'");
    for (const key of [
      "purchaseId",
      "restaurantId",
      "expenseCategoryId",
      "operatingExpenseId",
      "supplierName",
      "referenceNumber",
      "totalAmount",
      "recordedAt",
      "lines",
    ]) {
      expect(sql).toContain(`'${key}'`);
    }
  });

  it("ships rollback-only remote probes covering success, rejection, and immutability", async () => {
    const probe = await readFile(probePath, "utf8");
    expect(probe).toMatch(/^BEGIN;/);
    expect(probe).toMatch(/ROLLBACK;\s*$/);
    expect(probe).toContain("register_inventory_purchase");
    expect(probe).toContain("purchase did not create exact atomic records");
    expect(probe).toContain("unauthorized purchase was accepted");
    expect(probe).toContain("invalid purchase left partial state");
    expect(probe).toContain("inventory_purchases history is immutable");
    expect(probe).toContain("additional purchase-origin movement was accepted");
    expect(probe).toContain("additional purchase-origin expense was accepted");
    for (const rejected of [
      "cross-tenant category was accepted",
      "inactive category was accepted",
      "missing category was accepted",
      "cross-tenant item was accepted",
      "inactive item was accepted",
      "missing item was accepted",
      "malformed numeric purchase was accepted",
      "validation rejection left residual purchase records",
    ]) {
      expect(probe).toContain(rejected);
    }
  });
});
