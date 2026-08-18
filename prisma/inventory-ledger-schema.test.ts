import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const schemaPath = new URL("./schema.prisma", import.meta.url);
const migrationPath = new URL(
  "./migrations/20260816190000_create_inventory_ledger_schema/migration.sql",
  import.meta.url,
);

describe("inventory ledger schema", () => {
  it("models all item, movement, origin, alert, and derived-balance types", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const definition of [
      "model InventoryItem",
      "model InventoryMovement",
      "model InventoryAlert",
      "view InventoryBalance",
      "enum InventoryItemType",
      "enum InventoryMovementType",
      "enum InventoryBusinessOriginType",
      "enum InventoryAlertStatus",
    ]) {
      expect(schema).toContain(definition);
    }

    for (const itemType of ["RAW_INGREDIENT", "PRODUCED_ITEM", "RESALE_ITEM"]) {
      expect(schema).toMatch(new RegExp(`^\\s*${itemType}$`, "m"));
    }

    for (const movementType of [
      "PURCHASE",
      "PRODUCTION_CONSUMPTION",
      "PRODUCTION_OUTPUT",
      "SALE",
      "ADJUSTMENT",
      "WASTE",
      "ROLLBACK",
    ]) {
      expect(schema).toMatch(new RegExp(`^\\s*${movementType}$`, "m"));
    }

    const inventoryItemSchema = schema.slice(
      schema.indexOf("model InventoryItem"),
      schema.indexOf("model InventoryMovement"),
    );
    expect(inventoryItemSchema).not.toMatch(/currentStock|currentBalance/);
    expect(schema).toContain('previewFeatures = ["views"]');
  });

  it("stores signed, origin-linked movements with restaurant-safe references", async () => {
    const schema = await readFile(schemaPath, "utf8");
    const migration = await readFile(migrationPath, "utf8");

    expect(schema).toMatch(
      /quantityDelta\s+Decimal\s+@map\("quantity_delta"\) @db\.Decimal\(14, 3\)/,
    );
    expect(schema).toMatch(
      /businessOriginId\s+String\s+@map\("business_origin_id"\) @db\.Uuid/,
    );
    expect(migration).toContain(
      "FOREIGN KEY (restaurant_id, inventory_item_id) REFERENCES public.inventory_items(restaurant_id, id)",
    );
    expect(migration).toContain(
      "FOREIGN KEY (restaurant_id, inventory_item_id, reversed_movement_id) REFERENCES public.inventory_movements(restaurant_id, inventory_item_id, id)",
    );
    expect(migration).toContain(
      "FOREIGN KEY (recorded_by_id) REFERENCES public.application_users(id)",
    );
    expect(migration).toContain("CHECK (quantity_delta <> 0)");
    expect(migration).toContain(
      "type IN ('PURCHASE', 'PRODUCTION_OUTPUT') AND quantity_delta > 0",
    );
    expect(migration).toContain(
      "type IN ('PRODUCTION_CONSUMPTION', 'SALE', 'WASTE') AND quantity_delta < 0",
    );
    expect(migration).toContain("type IN ('ADJUSTMENT', 'ROLLBACK')");
    expect(migration).toContain(
      "reversed_movement_id IS NULL OR type = 'ROLLBACK'",
    );
    expect(migration).toContain("NEW.quantity_delta * reversed_quantity >= 0");
  });

  it("derives balances and enforces configurable negative-stock policy under a row lock", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("inventory_policy ? 'allowNegativeStock'");
    expect(migration).toContain(
      "jsonb_typeof(inventory_policy -> 'allowNegativeStock') = 'boolean'",
    );
    expect(migration).toContain(
      "CREATE FUNCTION public.validate_inventory_movement()",
    );
    expect(migration).toContain("FOR UPDATE OF item;");
    expect(migration).toContain("SELECT COALESCE(sum(quantity_delta), 0)");
    expect(migration).toContain(
      "current_balance + NEW.quantity_delta < 0 AND NOT allow_negative_stock",
    );
    expect(migration).toContain(
      "movement unit must match the inventory item unit",
    );
    expect(migration).toContain("CREATE VIEW public.inventory_balances");
    expect(migration).toContain("WITH (security_invoker = true)");
    expect(migration).toContain(
      "COALESCE(sum(movement.quantity_delta), 0)::numeric(14, 3) AS current_balance",
    );
    expect(migration).not.toMatch(/UPDATE\s+public\.inventory_items\s+SET/i);
  });

  it("protects movement history and item aggregation identity", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("CREATE TRIGGER inventory_movements_immutable");
    expect(migration).toContain(
      "BEFORE UPDATE OR DELETE ON public.inventory_movements",
    );
    expect(migration).toContain(
      "CREATE TRIGGER inventory_items_protect_identity",
    );
    expect(migration).toContain(
      "BEFORE UPDATE OF type, unit_of_measure ON public.inventory_items",
    );
    expect(migration).toContain(
      "inventory item type and unit are immutable after its first movement",
    );
  });

  it("supports one active alert per item and immutable resolved history", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "CONSTRAINT inventory_alerts_threshold_nonnegative CHECK (threshold >= 0)",
    );
    expect(migration).toContain("(status = 'ACTIVE' AND resolved_at IS NULL)");
    expect(migration).toContain(
      "status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_at >= opened_at",
    );
    expect(migration).toContain(
      "CREATE UNIQUE INDEX inventory_alerts_one_active_per_item_idx",
    );
    expect(migration).toContain("WHERE status = 'ACTIVE'");
    expect(migration).toContain(
      "inventory alerts only allow active-to-resolved transitions",
    );
    expect(migration).toContain("inventory alert history cannot be deleted");
  });

  it("leaves inventory tables default-deny and contains no seed data", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const names = [
      ...migration.matchAll(
        /^(?:\\s*(?:ADD )?CONSTRAINT\\s+|CREATE (?:UNIQUE )?INDEX\\s+|CREATE (?:CONSTRAINT )?TRIGGER\\s+|CREATE (?:TYPE|TABLE|FUNCTION|VIEW) public\\.)([a-z][a-z0-9_]*)/gm,
      ),
    ].map((match) => match[1]);

    for (const table of [
      "inventory_items",
      "inventory_movements",
      "inventory_alerts",
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
