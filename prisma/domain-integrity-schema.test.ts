import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260816210000_harden_domain_integrity_schema/migration.sql",
  import.meta.url,
);
const rollbackHardeningPath = new URL(
  "./migrations/20260816220000_require_rollback_movement_reference/migration.sql",
  import.meta.url,
);
const rollbackProbePath = new URL(
  "./probes/T-014-rollback-integrity-probes.sql",
  import.meta.url,
);

describe("cross-domain database integrity hardening", () => {
  it("requires complete order and basket aggregates at transaction commit", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "CREATE FUNCTION public.assert_order_is_complete(order_id_to_check uuid)",
    );
    expect(migration).toContain("must contain at least one customer basket");
    expect(migration).toContain("must contain at least one current order line");
    expect(migration).toContain("must contain at least one order line");
    for (const trigger of [
      "orders_require_complete_aggregate",
      "baskets_require_complete_aggregate",
      "order_lines_require_complete_aggregate",
    ]) {
      expect(migration).toContain(`CREATE CONSTRAINT TRIGGER ${trigger}`);
    }
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)?.length).toBe(5);
  });

  it("protects order-line ownership and permits only forward snapshot revisions", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "CREATE FUNCTION public.protect_order_line_identity_and_revision()",
    );
    for (const field of ["id", "restaurant_id", "basket_id", "created_at"]) {
      expect(migration).toContain(`NEW.${field} IS DISTINCT FROM OLD.${field}`);
    }
    expect(migration).toContain(
      "order line current snapshot must advance to a later revision",
    );
    expect(migration).toContain(
      "BEFORE UPDATE OR DELETE ON public.order_lines",
    );
  });

  it("validates canonical sale snapshots against immutable catalog configuration", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "CREATE FUNCTION public.validate_snapshot_modifications(",
    );
    for (const key of ["id", "name", "priceAdjustment"]) {
      expect(migration).toContain(`modification ? '${key}'`);
    }
    expect(migration).toContain("FROM jsonb_object_keys(modification)");
    expect(migration).toContain("snapshot contains a duplicate modification");
    expect(migration).toContain("FROM public.product_options");
    expect(migration).toContain("FROM public.product_removable_ingredients");
    expect(migration).toContain(
      "snapshot price adjustment does not match catalog configuration",
    );
    expect(migration).toContain(
      "sale snapshot product and tax values must match the product version",
    );
    expect(migration).toContain(
      "NEW.final_unit_price <> NEW.base_unit_price + option_adjustments + removal_adjustments",
    );
    expect(migration).toContain(
      "BEFORE INSERT ON public.order_line_sale_snapshots",
    );
  });

  it("validates payment and expense snapshots and their historical timing", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "payment method snapshot must match configured method",
    );
    expect(migration).toContain(
      "payment timestamp cannot precede basket creation",
    );
    expect(migration).toContain(
      "overage authorization cannot occur after payment recording",
    );
    expect(migration).toContain(
      "operating expense category snapshot must match configured category",
    );
    expect(migration).toContain(
      "operating expense timestamps cannot precede category creation",
    );
    expect(migration).toContain("BEFORE INSERT ON public.operating_expenses");
  });

  it("requires recipe ingredients through deferred completeness checks", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "CREATE FUNCTION public.assert_recipe_version_has_ingredient(version_id_to_check uuid)",
    );
    expect(migration).toContain("must contain at least one ingredient");
    expect(migration).toContain(
      "CREATE CONSTRAINT TRIGGER recipe_versions_require_ingredient",
    );
    expect(migration).toContain(
      "CREATE CONSTRAINT TRIGGER recipe_ingredients_preserve_completeness",
    );
  });

  it("maps inventory movement origins and rejects malformed rollbacks", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const rollbackHardening = await readFile(rollbackHardeningPath, "utf8");

    expect(migration).toContain(
      "ADD CONSTRAINT inventory_movements_origin_matches_type",
    );
    for (const mapping of [
      "type = 'PURCHASE' AND business_origin_type = 'PURCHASE'",
      "type IN ('PRODUCTION_CONSUMPTION', 'PRODUCTION_OUTPUT') AND business_origin_type = 'PRODUCTION'",
      "type = 'SALE' AND business_origin_type = 'SALE'",
      "type = 'ADJUSTMENT' AND business_origin_type = 'ADJUSTMENT'",
      "type = 'WASTE' AND business_origin_type = 'WASTE'",
      "type = 'ROLLBACK' AND business_origin_type = 'ROLLBACK'",
    ]) {
      expect(migration).toContain(mapping);
    }
    expect(migration).toContain(
      "CREATE UNIQUE INDEX inventory_movements_one_reversal_idx",
    );
    expect(migration).toContain(
      "production movement origin must reference a same-restaurant production batch",
    );
    expect(migration).toContain(
      "sale movement origin must reference a same-restaurant order",
    );
    expect(migration).toContain("rollback movement cannot reference itself");
    expect(migration).toContain(
      "rollback movements cannot reverse another rollback",
    );
    expect(migration).toContain(
      "rollback must reference an earlier inventory movement",
    );
    expect(migration).toContain(
      "rollback movement must have the opposite sign of its referenced movement",
    );
    expect(rollbackHardening).toContain(
      "ADD CONSTRAINT inventory_movements_rollback_reference_required",
    );
    expect(rollbackHardening).toContain(
      "CHECK (type <> 'ROLLBACK' OR reversed_movement_id IS NOT NULL)",
    );
  });

  it("provides executable transaction-scoped rollback rejection and acceptance probes", async () => {
    const probe = await readFile(rollbackProbePath, "utf8");

    expect(probe.trimStart()).toMatch(/^BEGIN;/);
    expect(probe.trimEnd()).toMatch(/ROLLBACK;$/);
    expect(probe).toContain("WHEN check_violation THEN");
    expect(probe).toContain(
      "negative probe failed: rollback without a reference was accepted",
    );
    expect(probe).toContain(
      "positive probe failed: valid rollback was not recorded",
    );
    expect(probe).toContain("SET CONSTRAINTS ALL IMMEDIATE;");
    expect(probe).toContain("CURRENT_TIMESTAMP - INTERVAL '1 minute'");
  });

  it("protects historical ownership and creation identity", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "order identity, ownership, and creation timestamp are immutable",
    );
    expect(migration).toContain(
      "basket identity, ownership, and creation timestamp are immutable",
    );
    expect(migration).toContain(
      "production batch recipe and creation identity are immutable",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.validate_order_lifecycle_transition()",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.validate_basket_lifecycle_transition()",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.validate_production_batch_lifecycle()",
    );
  });

  it("contains no workflow, policy, seed, or unsafe identifier additions", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const names = [
      ...migration.matchAll(
        /^(?:\\s*(?:ADD )?CONSTRAINT\\s+|CREATE (?:UNIQUE )?INDEX\\s+|CREATE (?:CONSTRAINT )?TRIGGER\\s+|CREATE (?:OR REPLACE )?(?:FUNCTION|VIEW) public\\.)([a-z][a-z0-9_]*)/gm,
      ),
    ].map((match) => match[1]);

    expect(migration).not.toMatch(/\\bCREATE\\s+POLICY\\b/i);
    expect(migration).not.toMatch(/\\bINSERT\\s+INTO\\b/i);
    expect(migration).not.toMatch(
      /\\bUPDATE\s+public\.(orders|payments|production_batches)\b/i,
    );
    expect(names.every((name) => Buffer.byteLength(name, "utf8") <= 63)).toBe(
      true,
    );
    expect(new Set(names).size).toBe(names.length);
  });
});
