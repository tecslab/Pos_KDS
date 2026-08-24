import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const path = new URL(
  "./migrations/20260824120000_manage_product_categories_atomically/migration.sql",
  import.meta.url,
);

describe("product category administration RPC", () => {
  it("atomically binds exact audit snapshots to create, edit, reorder and activation", async () => {
    const sql = await readFile(path, "utf8");
    expect(sql).toContain("CREATE FUNCTION public.save_product_category");
    expect(sql).toContain(
      "audit_event -> 'previousValues' IS DISTINCT FROM previous_values",
    );
    expect(sql).toContain("product_category.created");
    expect(sql).toContain("product_category.updated");
    expect(sql).toContain("product_category.reordered");
    expect(sql).toContain("product_category.activated");
    expect(sql).toContain("product_category.deactivated");
    expect(sql).toContain("INSERT INTO public.product_categories");
    expect(sql).toContain("INSERT INTO public.audit_events");
    expect(sql).not.toMatch(/DELETE FROM public\.product_categories/i);
  });

  it("locks the restaurant-scoped target and requires its product catalog", async () => {
    const sql = await readFile(path, "utf8");
    expect(sql).toContain("JOIN public.product_catalogs AS catalog");
    expect(sql).toMatch(
      /WHERE id = target_category_id\s+AND restaurant_id = target_restaurant_id\s+FOR UPDATE/,
    );
    expect(sql).toContain(
      "product_categories.restaurant_id = EXCLUDED.restaurant_id",
    );
  });

  it("is service-role-only", async () => {
    const sql = await readFile(path, "utf8");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]+TO service_role/);
  });
});
