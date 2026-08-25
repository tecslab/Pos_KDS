import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260824150000_manage_inventory_items_atomically/migration.sql",
  import.meta.url,
);

describe("inventory item administration RPC", () => {
  it("atomically persists exact create/edit/activation audits without stock mutations", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE FUNCTION public.save_inventory_item");
    expect(sql).toContain(
      "audit_event -> 'previousValues' IS DISTINCT FROM previous_values",
    );
    for (const action of ["created", "updated", "activated", "deactivated"])
      expect(sql).toContain(`inventory_item.${action}`);
    expect(sql).toContain("INSERT INTO public.inventory_items");
    expect(sql).toContain("INSERT INTO public.audit_events");
    expect(sql).not.toMatch(/INSERT INTO public\.inventory_movements/i);
    expect(sql).not.toMatch(/DELETE FROM public\.inventory_items/i);
  });

  it("uses a dedicated administrator permission and a service-role-only RPC", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("'administration.inventory.manage'");
    expect(sql).toContain("role.code = 'administrator'");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.save_inventory_item\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.save_inventory_item\([\s\S]+TO service_role/,
    );
  });

  it("locks the restaurant-scoped target and preserves soft-deleted history", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toMatch(
      /WHERE id = target_inventory_item_id\s+AND restaurant_id = target_restaurant_id\s+FOR UPDATE/,
    );
    expect(sql).toContain("inventory_items.deleted_at IS NULL");
  });
});
