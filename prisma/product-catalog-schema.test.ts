import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const schemaPath = new URL("./schema.prisma", import.meta.url);
const migrationPath = new URL(
  "./migrations/20260816140000_create_versioned_product_catalog_schema/migration.sql",
  import.meta.url,
);

describe("versioned product catalog schema", () => {
  it("models stable products with immutable sellable-version snapshots", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const model of [
      "ProductCatalog",
      "ProductCategory",
      "Product",
      "ProductVersion",
      "ProductOption",
      "ProductRemovableIngredient",
    ]) {
      expect(schema).toContain(`model ${model}`);
    }

    for (const snapshotField of [
      "versionNumber",
      "name",
      "unitPrice",
      "printerAlias",
      "taxRateId",
      "taxCode",
      "taxName",
      "taxRate",
      "priceIncludesTax",
    ]) {
      expect(schema).toMatch(new RegExp(`^\\s*${snapshotField}\\s+`, "m"));
    }

    expect(schema).toMatch(
      /priceAdjustment\s+Decimal\?\s+@map\("price_adjustment"\) @db\.Decimal\(12, 2\)/,
    );
    expect(schema).toMatch(/printerAlias\s+String\s+@map\("printer_alias"\)/);
    expect(schema).toMatch(
      /model ProductCatalog \{\s+restaurantId\s+String\s+@id @map\("restaurant_id"\) @db\.Uuid/,
    );
    expect(schema).toMatch(/^\s*productCatalog\s+ProductCatalog\?$/m);
    expect(schema).not.toMatch(/^\s*productCatalogs\s+ProductCatalog\[\]$/m);
    expect(schema).toContain(
      "@@unique([restaurantId, productId, versionNumber])",
    );
    expect(schema).toContain(
      "@@index([restaurantId, categoryId, isActive, displayOrder])",
    );
  });

  it("uses composite foreign keys to prohibit cross-restaurant catalog references", async () => {
    const migration = await readFile(migrationPath, "utf8");

    for (const relation of [
      "FOREIGN KEY (restaurant_id) REFERENCES public.product_catalogs(restaurant_id)",
      "FOREIGN KEY (restaurant_id, category_id) REFERENCES public.product_categories(restaurant_id, id)",
      "FOREIGN KEY (restaurant_id, product_id) REFERENCES public.products(restaurant_id, id)",
      "FOREIGN KEY (restaurant_id, tax_rate_id) REFERENCES public.restaurant_tax_rates(restaurant_id, id)",
      "FOREIGN KEY (restaurant_id, product_version_id) REFERENCES public.product_versions(restaurant_id, id)",
    ]) {
      expect(migration).toContain(relation);
    }

    expect(migration).toContain(
      "ADD CONSTRAINT restaurant_tax_rates_restaurant_id_id_key UNIQUE (restaurant_id, id)",
    );
    expect(migration).toContain("ON DELETE RESTRICT ON UPDATE RESTRICT");
  });

  it("enforces catalog bounds, snapshots, soft deletion, and immutable history", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("CHECK (version_number > 0)");
    expect(migration).toContain("CHECK (unit_price >= 0)");
    expect(migration).toContain("printer_alias text NOT NULL");
    expect(migration).toContain(
      "CONSTRAINT product_versions_printer_alias_not_blank CHECK (btrim(printer_alias) <> '')",
    );
    expect(migration).toContain("CHECK (tax_rate >= 0 AND tax_rate <= 1)");
    expect(migration).toContain("CHECK (display_order >= 0)");
    expect(migration).toContain("price_adjustment numeric(12, 2)");

    for (const field of ["name", "tax_code", "tax_name"]) {
      expect(migration).toContain(`CHECK (btrim(${field}) <> '')`);
    }
    for (const table of [
      "product_catalogs",
      "product_categories",
      "products",
    ]) {
      expect(migration).toContain(
        `CONSTRAINT ${table}_deleted_not_active CHECK (deleted_at IS NULL OR NOT is_active)`,
      );
    }
    for (const table of [
      "product_versions",
      "product_options",
      "product_removable_ingredients",
    ]) {
      expect(migration).toContain(`CREATE TRIGGER ${table}_immutable`);
      expect(migration).toContain(`BEFORE UPDATE OR DELETE ON public.${table}`);
    }
  });

  it("enables default-deny RLS and contains no seed data", async () => {
    const migration = await readFile(migrationPath, "utf8");

    for (const table of [
      "product_catalogs",
      "product_categories",
      "products",
      "product_versions",
      "product_options",
      "product_removable_ingredients",
    ]) {
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      );
    }

    expect(migration).not.toMatch(/\bCREATE\s+POLICY\b/i);
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i);
  });

  it("keeps explicitly named PostgreSQL objects distinct within the identifier limit", async () => {
    const schema = await readFile(schemaPath, "utf8");
    const migration = await readFile(migrationPath, "utf8");
    const names = [
      ...migration.matchAll(
        /^(?:\s*(?:ADD )?CONSTRAINT\s+|CREATE (?:UNIQUE )?INDEX\s+|CREATE (?:CONSTRAINT )?TRIGGER\s+|CREATE (?:TABLE|FUNCTION) public\.)([a-z][a-z0-9_]*)/gm,
      ),
    ].map((match) => match[1]);

    expect(names.every((name) => Buffer.byteLength(name, "utf8") <= 63)).toBe(
      true,
    );
    expect(new Set(names).size).toBe(names.length);

    for (const identifier of [
      "product_options_version_display_order_idx",
      "product_removable_ingredients_version_name_key",
      "product_removable_ingredients_version_display_order_idx",
    ]) {
      expect(schema).toContain(`map: "${identifier}"`);
      expect(migration).toContain(identifier);
    }
  });
});
