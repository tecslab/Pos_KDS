import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const schemaPath = new URL("./schema.prisma", import.meta.url);
const migrationPath = new URL(
  "./migrations/20260816200000_create_recipe_production_expense_schema/migration.sql",
  import.meta.url,
);

describe("recipe, production, and expense schema", () => {
  it("models versioned recipes, batches, and operating expenses", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const definition of [
      "model Recipe",
      "model RecipeVersion",
      "model RecipeIngredient",
      "model ProductionBatch",
      "model ExpenseCategory",
      "model OperatingExpense",
      "enum ProductionBatchStatus",
      "enum ExpenseOriginType",
    ]) {
      expect(schema).toContain(definition);
    }

    for (const status of ["PLANNED", "IN_PROGRESS", "COMPLETED"]) {
      expect(schema).toMatch(new RegExp(`^\\s*${status}$`, "m"));
    }
    for (const origin of ["MANUAL", "PURCHASE"]) {
      expect(schema).toMatch(new RegExp(`^\\s*${origin}$`, "m"));
    }

    expect(schema).toMatch(
      /producedQuantity\s+Decimal\s+@map\("produced_quantity"\) @db\.Decimal\(14, 3\)/,
    );
    expect(schema).toMatch(
      /requiredQuantity\s+Decimal\s+@map\("required_quantity"\) @db\.Decimal\(14, 3\)/,
    );
    expect(schema).toContain(
      '@@unique([restaurantId, recipeId, versionNumber], map: "recipe_versions_recipe_number_key")',
    );
  });

  it("uses composite restaurant-safe product, item, version, and category references", async () => {
    const migration = await readFile(migrationPath, "utf8");

    for (const relation of [
      "FOREIGN KEY (restaurant_id, product_id) REFERENCES public.products(restaurant_id, id)",
      "FOREIGN KEY (restaurant_id, output_inventory_item_id) REFERENCES public.inventory_items(restaurant_id, id)",
      "FOREIGN KEY (restaurant_id, recipe_id) REFERENCES public.recipes(restaurant_id, id)",
      "FOREIGN KEY (restaurant_id, recipe_version_id) REFERENCES public.recipe_versions(restaurant_id, id)",
      "FOREIGN KEY (restaurant_id, inventory_item_id) REFERENCES public.inventory_items(restaurant_id, id)",
      "FOREIGN KEY (restaurant_id, expense_category_id) REFERENCES public.expense_categories(restaurant_id, id)",
    ]) {
      expect(migration).toContain(relation);
    }

    expect(migration).toContain("ON DELETE RESTRICT ON UPDATE RESTRICT");
  });

  it("preserves recipe history and validates raw inputs and produced output units", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "recipe output inventory item must be a produced item",
    );
    expect(migration).toContain(
      "recipe ingredients must be raw inventory items",
    );
    expect(migration).toContain(
      "recipe version output unit must match its inventory item unit",
    );
    expect(migration).toContain(
      "recipe ingredient unit must match its inventory item unit",
    );
    expect(migration).toContain("CHECK (produced_quantity > 0)");
    expect(migration).toContain("CHECK (required_quantity > 0)");
    expect(migration).toContain("CREATE TRIGGER recipe_versions_immutable");
    expect(migration).toContain("CREATE TRIGGER recipe_ingredients_immutable");
    expect(migration).toContain(
      "BEFORE UPDATE OR DELETE ON public.recipe_versions",
    );
    expect(migration).toContain(
      "BEFORE UPDATE OR DELETE ON public.recipe_ingredients",
    );
    expect(migration).toContain(
      "recipe product and output item are immutable after its first version",
    );
    expect(migration).toContain(
      "inventory item type and unit are immutable after operational use",
    );
  });

  it("enforces the production batch lifecycle without creating stock movements", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "CONSTRAINT production_batches_planned_quantity_positive CHECK (planned_quantity > 0)",
    );
    expect(migration).toContain(
      "CONSTRAINT production_batches_timestamps_monotonic",
    );
    expect(migration).toContain("CONSTRAINT production_batches_status_shape");
    expect(migration).toContain(
      "production batches must begin in PLANNED status",
    );
    expect(migration).toContain(
      "(OLD.status = 'PLANNED' AND NEW.status = 'IN_PROGRESS')",
    );
    expect(migration).toContain(
      "(OLD.status = 'IN_PROGRESS' AND NEW.status = 'COMPLETED')",
    );
    expect(migration).toContain("completed production batches are immutable");
    expect(migration).toContain(
      "production batches cannot be deleted after execution begins",
    );
    expect(migration).not.toMatch(
      /INSERT\s+INTO\s+public\.inventory_movements/i,
    );
  });

  it("snapshots categories and makes operating expense history immutable", async () => {
    const schema = await readFile(schemaPath, "utf8");
    const migration = await readFile(migrationPath, "utf8");

    for (const field of [
      "expenseCategoryCode",
      "expenseCategoryName",
      "incurredAt",
      "recordedAt",
      "recordedById",
      "referenceNumber",
      "comments",
      "originType",
      "originId",
    ]) {
      expect(schema).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }

    expect(migration).toContain(
      "CONSTRAINT operating_expenses_amount_positive CHECK (amount > 0)",
    );
    expect(migration).toContain(
      "CONSTRAINT operating_expenses_description_not_blank",
    );
    expect(migration).toContain(
      "(origin_type = 'MANUAL' AND origin_id IS NULL)",
    );
    expect(migration).toContain(
      "(origin_type = 'PURCHASE' AND origin_id IS NOT NULL)",
    );
    expect(migration).toContain("CREATE TRIGGER operating_expenses_immutable");
    expect(migration).toContain(
      "BEFORE UPDATE OR DELETE ON public.operating_expenses",
    );
  });

  it("keeps new tables default-deny, seed-free, and within identifier limits", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const names = [
      ...migration.matchAll(
        /^(?:\\s*(?:ADD )?CONSTRAINT\\s+|CREATE (?:UNIQUE )?INDEX\\s+|CREATE (?:CONSTRAINT )?TRIGGER\\s+|CREATE (?:TYPE|TABLE|FUNCTION) public\\.)([a-z][a-z0-9_]*)/gm,
      ),
    ].map((match) => match[1]);

    for (const table of [
      "recipes",
      "recipe_versions",
      "recipe_ingredients",
      "production_batches",
      "expense_categories",
      "operating_expenses",
    ]) {
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      );
    }

    expect(migration).not.toMatch(/\\bCREATE\\s+POLICY\\b/i);
    expect(migration).not.toMatch(/\\bINSERT\\s+INTO\\b/i);
    expect(names.every((name) => Buffer.byteLength(name, "utf8") <= 63)).toBe(
      true,
    );
    expect(new Set(names).size).toBe(names.length);
  });
});
