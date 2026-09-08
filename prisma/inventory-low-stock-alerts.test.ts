import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260907093000_emit_inventory_low_stock_alerts/migration.sql",
  "utf8",
);
const movementValidationMigration = readFileSync(
  "prisma/migrations/20260829110000_reconcile_resale_inventory_on_order_modification/migration.sql",
  "utf8",
);
const probe = readFileSync(
  "prisma/probes/T-062-inventory-low-stock-alert-probes.sql",
  "utf8",
);

describe("inventory low-stock alert migration", () => {
  it("derives strict low stock from the immutable movement ledger", () => {
    expect(migration).toContain("AFTER INSERT ON public.inventory_movements");
    expect(migration).toMatch(/current_balance < minimum_level AND NOT FOUND/);
    expect(migration).toMatch(/current_balance >= minimum_level AND FOUND/);
    expect(migration).toMatch(/sum\(movement\.quantity_delta\)/);
    expect(migration).not.toMatch(/UPDATE public\.inventory_movements/i);
    expect(migration).not.toMatch(/DELETE FROM public\.inventory_movements/i);
  });

  it("persists immutable movement-linked state changes only", () => {
    expect(migration).toContain(
      "CREATE TABLE public.inventory_alert_transitions",
    );
    expect(migration).toContain("inventory_alert_transitions_movement_fkey");
    expect(migration).toContain("UNIQUE (inventory_alert_id, status)");
    expect(migration).toContain("inventory_alert_transitions_immutable");
    expect(migration).toContain(
      "ALTER TABLE public.inventory_alert_transitions ENABLE ROW LEVEL SECURITY",
    );
  });

  it("serializes concurrent movement decisions per item with exact-once guards", () => {
    expect(movementValidationMigration).toMatch(
      /WHERE item\.restaurant_id = NEW\.restaurant_id[\s\S]+FOR UPDATE OF item/,
    );
    expect(migration).toMatch(
      /WHERE item\.restaurant_id = NEW\.restaurant_id[\s\S]+FOR UPDATE OF item/,
    );
    expect(migration).toContain("UNIQUE (inventory_alert_id, status)");
    expect(migration).toContain(
      "UNIQUE (restaurant_id, inventory_item_id, inventory_movement_id)",
    );
    expect(migration).toContain(
      "inventory_movements_reconcile_low_stock_alert",
    );
  });

  it.each([
    "confirm_order",
    "modify_pending_order",
    "cancel_order",
    "register_inventory_purchase",
    "register_inventory_adjustment_or_waste",
  ])(
    "returns transitions from %s without widening RPC access",
    (functionName) => {
      expect(migration).toContain(`CREATE FUNCTION public.${functionName}(`);
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${functionName}\\([\\s\\S]+?FROM PUBLIC, anon, authenticated`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${functionName}\\([\\s\\S]+?TO service_role`,
        ),
      );
    },
  );

  it("provides a rollback-only remote probe for all producers and tenant isolation", () => {
    expect(probe.trimStart()).toMatch(/^BEGIN;/);
    expect(probe.trimEnd()).toMatch(/ROLLBACK;$/);
    for (const functionName of [
      "confirm_order",
      "modify_pending_order",
      "cancel_order",
      "register_inventory_purchase",
      "register_inventory_adjustment_or_waste",
    ]) {
      expect(probe).toContain(`public.${functionName}(`);
    }
    expect(probe).toContain("inventory alert state crossed tenant boundaries");
    expect(probe).toContain("low-stock state transitions were not exact-once");
    expect(probe).toContain(
      "failed operation retained inventory alert effects",
    );
  });
});
