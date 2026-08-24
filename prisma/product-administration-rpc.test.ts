import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const schemaPath = new URL("./schema.prisma", import.meta.url);
const migrationPath = new URL(
  "./migrations/20260824130000_manage_products_atomically/migration.sql",
  import.meta.url,
);
const repairMigrationPath = new URL(
  "./migrations/20260824140000_preserve_product_version_source_eligibility/migration.sql",
  import.meta.url,
);

describe("product administration schema and RPC", () => {
  it("adds immutable version-level recipe and resale links with scoped constraints", async () => {
    const [schema, sql] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(migrationPath, "utf8"),
    ]);
    expect(schema).toMatch(
      /recipeId\s+String\?\s+@map\("recipe_id"\) @db\.Uuid/,
    );
    expect(schema).toMatch(
      /resaleInventoryItemId\s+String\?\s+@map\("resale_inventory_item_id"\) @db\.Uuid/,
    );
    expect(sql).toContain(
      "FOREIGN KEY (restaurant_id, recipe_id)\n    REFERENCES public.recipes(restaurant_id, id)",
    );
    expect(sql).toContain(
      "FOREIGN KEY (restaurant_id, resale_inventory_item_id)\n    REFERENCES public.inventory_items(restaurant_id, id)",
    );
    expect(sql).toContain("product_versions_source_exclusive");
    expect(sql).toContain("product_id = NEW.product_id");
    expect(sql).toContain("type = 'RESALE_ITEM'");
  });

  it("creates N+1 and fresh immutable children in the audited atomic RPC", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE FUNCTION public.save_product");
    expect(sql).toContain("current_version_number + 1");
    expect(sql).toContain("expected_previous_version_number");
    expect(sql).toContain("INSERT INTO public.product_versions");
    expect(sql).toContain("INSERT INTO public.product_options");
    expect(sql).toContain("INSERT INTO public.product_removable_ingredients");
    expect(sql).toContain("INSERT INTO public.audit_events");
    expect(sql).toContain(
      "audit_event -> 'previousValues' IS DISTINCT FROM previous_values",
    );
    expect(sql).toContain("product.created");
    expect(sql).toContain("product.updated");
    expect(sql).toContain("product.activated");
    expect(sql).toContain("product.deactivated");
    expect(sql).not.toMatch(/UPDATE public\.product_versions/i);
    expect(sql).not.toMatch(/DELETE FROM public\.product_/i);
  });

  it("locks product and references and rejects stale or invalid links", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toMatch(
      /FROM public\.products[\s\S]+WHERE id = target_product_id[\s\S]+FOR UPDATE/,
    );
    expect(sql).toContain("FOR KEY SHARE");
    expect(sql).toContain("product version is stale");
    expect(sql).toContain("product recipe is not eligible");
    expect(sql).toContain("resale inventory item is not eligible");
  });

  it("is service-role-only and performs no inventory transaction", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.save_product\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.save_product\([\s\S]+TO service_role/,
    );
    expect(sql).not.toMatch(/INSERT INTO public\.inventory_movements/i);
    expect(sql).not.toMatch(/UPDATE public\.inventory_/i);
  });

  it("durably rejects recipe product reassignment after a version links it", async () => {
    const sql = await readFile(repairMigrationPath, "utf8");
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.protect_recipe_identity()",
    );
    expect(sql).toMatch(
      /NEW\.product_id IS DISTINCT FROM OLD\.product_id[\s\S]+FROM public\.product_versions[\s\S]+recipe_id = OLD\.id/,
    );
    expect(sql).toContain(
      "recipe product is immutable after a product version links it",
    );
  });

  it("durably rejects resale type reassignment after a version links the item", async () => {
    const sql = await readFile(repairMigrationPath, "utf8");
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.protect_inventory_item_identity()",
    );
    expect(sql).toMatch(
      /NEW\.type IS DISTINCT FROM OLD\.type AND EXISTS \([\s\S]+FROM public\.product_versions[\s\S]+resale_inventory_item_id = OLD\.id/,
    );
    expect(sql).toContain(
      "resale inventory item type is immutable after a product version links it",
    );
  });

  it("keeps the repair additive and free of inventory transactions", async () => {
    const sql = await readFile(repairMigrationPath, "utf8");
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.validate_product_version_source()",
    );
    expect(sql).toContain("'product-version-recipe:'");
    expect(sql).toContain("'product-version-resale:'");
    expect(sql.match(/pg_advisory_xact_lock/g)).toHaveLength(4);
    expect(sql).not.toMatch(
      /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.product_versions/i,
    );
    expect(sql).not.toMatch(/INSERT INTO public\.inventory_movements/i);
    expect(sql).not.toMatch(/ALTER TABLE/i);
  });
});
