import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260908090000_complete_production_batches_atomically/migration.sql",
  import.meta.url,
);
const correctiveMigrationPath = new URL(
  "./migrations/20260908100000_fix_production_batch_completion_qualification/migration.sql",
  import.meta.url,
);
const probePath = new URL(
  "./probes/T-064-production-batch-completion-probes.sql",
  import.meta.url,
);

describe("production batch completion persistence", () => {
  it("enforces complete and exclusive recipe-derived movement provenance", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "CREATE FUNCTION public.assert_production_batch_integrity",
    );
    expect(sql).toContain("movement_count <> ingredient_count + 1");
    expect(sql).toContain("movement.type = 'PRODUCTION_CONSUMPTION'");
    expect(sql).toContain("movement.type = 'PRODUCTION_OUTPUT'");
    expect(sql).toContain("movement.quantity_delta = -round(");
    expect(sql).toContain(
      "movement.quantity_delta = batch_record.produced_quantity",
    );
    expect(sql).toContain("movement.business_origin_type = 'PRODUCTION'");
    expect(sql).toContain("movement.reversed_movement_id IS NULL");
    expect(sql.match(/CREATE CONSTRAINT TRIGGER/g)).toHaveLength(2);
  });

  it("implements one service-role-only atomic RPC with permission and tenant checks", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE FUNCTION public.complete_production_batch(");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toContain("permission.code = 'production.batch.create'");
    expect(sql).toContain("application_user.is_active");
    expect(sql).toContain("version.restaurant_id = target_restaurant_id");
    expect(sql).toContain("item.restaurant_id = target_restaurant_id");
    expect(sql).toMatch(/ORDER BY item\.id\s+FOR UPDATE OF item/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.complete_production_batch\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.complete_production_batch\([\s\S]+TO service_role/,
    );
  });

  it("ships a forward-only correction with strict variable conflict handling and qualified batch updates", async () => {
    const sql = await readFile(correctiveMigrationPath, "utf8");
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.complete_production_batch(",
    );
    expect(sql).toContain("#variable_conflict error");
    expect(sql).toContain("v_batch_id uuid := gen_random_uuid()");
    expect(
      sql.match(/UPDATE public\.production_batches AS batch/g),
    ).toHaveLength(2);
    expect(
      sql.match(/WHERE batch\.restaurant_id = target_restaurant_id/g),
    ).toHaveLength(2);
    expect(sql).not.toMatch(/WHERE restaurant_id = target_restaurant_id/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.complete_production_batch\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.complete_production_batch\([\s\S]+TO service_role/,
    );
  });

  it("derives consumption from the selected immutable recipe version and ignores negative-stock policy", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("target_recipe_version_id");
    expect(sql).toContain(
      "ingredient.required_quantity * produced_quantity_value",
    );
    expect(sql).toContain("/ recipe_record.recipe_produced_quantity");
    expect(sql).toContain("PRODUCTION_INSUFFICIENT_INVENTORY");
    expect(sql).not.toContain("allowNegativeStock");
  });

  it("persists lifecycle, ledger, audit, and low-stock result in one function", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const statement of [
      "INSERT INTO public.production_batches",
      "SET status = 'IN_PROGRESS'",
      "'PRODUCTION_CONSUMPTION'",
      "'PRODUCTION_OUTPUT'",
      "SET status = 'COMPLETED'",
      "INSERT INTO public.audit_events",
      "'production_batch.completed'",
      "inventory_alert_transitions",
    ]) {
      expect(sql).toContain(statement);
    }
    for (const key of [
      "batchId",
      "recipeVersionId",
      "recipeVersionNumber",
      "productId",
      "producedQuantity",
      "completedById",
      "completedAt",
      "notes",
      "ingredientMovements",
      "outputMovement",
    ]) {
      expect(sql).toContain(`'${key}'`);
    }
  });

  it("ships rollback-only probes for success, rejection, integrity, and atomicity", async () => {
    const probe = await readFile(probePath, "utf8");
    expect(probe.trimStart()).toMatch(/^BEGIN;/);
    expect(probe.trimEnd()).toMatch(/ROLLBACK;$/);
    for (const evidence of [
      "production batch did not create exact atomic records",
      "selected historical recipe version was not preserved",
      "unauthorized production was accepted",
      "insufficient inventory was accepted",
      "insufficient production left partial state",
      "cross-tenant recipe version was accepted",
      "inactive ingredient was accepted",
      "completed production batch is immutable",
      "additional production-origin movement was accepted",
      "forced audit failure left partial production state",
    ]) {
      expect(probe).toContain(evidence);
    }
  });
});
