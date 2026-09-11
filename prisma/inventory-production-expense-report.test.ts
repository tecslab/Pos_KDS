import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "./migrations/20260911090000_read_inventory_production_expense_report/migration.sql",
  import.meta.url,
);
const labelRepairMigrationUrl = new URL(
  "./migrations/20260911110000_preserve_inventory_production_report_labels/migration.sql",
  import.meta.url,
);
const probeUrl = new URL(
  "./probes/T-069-inventory-production-expense-report-probes.sql",
  import.meta.url,
);

describe("inventory, production, and expense report aggregate", () => {
  it("uses reports.view defense in depth and service-role-only execution", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toContain("application_user.is_active = true");
    expect(sql).toContain("permission.code = 'reports.view'");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.read_inventory_production_expense_report[\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.read_inventory_production_expense_report[\s\S]+TO service_role/,
    );
  });

  it("uses half-open Guayaquil day and month boundaries over persisted data", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("inventory_movements_restaurant_recorded_report_idx");
    expect(sql).toContain("production_batches_restaurant_completed_report_idx");
    expect(sql).toContain("operating_expenses_restaurant_incurred_report_idx");
    expect(sql).toContain(
      "reporting_timezone IS DISTINCT FROM 'America/Guayaquil'",
    );
    expect(sql).toContain("movement.recorded_at >= requested_period_start");
    expect(sql).toContain("movement.recorded_at < requested_period_end");
    expect(sql).toContain("expense.incurred_at >= requested_month_start");
    expect(sql).toContain("expense.incurred_at < requested_month_end");
    expect(sql).not.toContain("CURRENT_DATE");
  });

  it("covers every ledger origin and uses immutable expense category snapshots", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    const labelRepairSql = await readFile(labelRepairMigrationUrl, "utf8");
    expect(sql).toContain("FROM public.inventory_movements AS movement");
    expect(sql).toContain("FROM public.inventory_purchases AS purchase");
    expect(sql).toContain("FROM public.production_batches AS batch");
    expect(sql).toContain("FROM public.inventory_adjustments AS adjustment");
    expect(sql).toContain("FROM public.inventory_waste_records AS waste");
    expect(sql).toContain("movement.type::text");
    expect(sql).toContain("movement.business_origin_type::text");
    expect(sql).toContain("expense.expense_category_code");
    expect(sql).toContain("expense.expense_category_name");
    expect(labelRepairSql).toContain("movement.inventory_item_name_snapshot");
    expect(labelRepairSql).toContain("batch.recipe_name_snapshot");
    expect(labelRepairSql).toContain(
      "batch.output_inventory_item_name_snapshot",
    );
    expect(labelRepairSql).toContain("Unattributed historical inventory item");
    expect(labelRepairSql).not.toContain("item.name AS inventory_item_name");
    const categoryAggregation = sql.slice(
      sql.indexOf("daily_expense_categories AS"),
      sql.indexOf("monthly_expense_days AS"),
    );
    expect(categoryAggregation).not.toContain("JOIN public.expense_categories");
  });

  it("ships rollback-only behavior coverage for all aggregate sources, boundaries, snapshots, authorization, and read-only behavior", async () => {
    const probe = await readFile(probeUrl, "utf8");
    expect(probe).toContain("BEGIN;");
    expect(probe.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    expect(probe).toContain(
      "SELECT * FROM public.read_inventory_production_expense_report",
    );
    expect(probe).toContain("expected reports.view denial");
    expect(probe).toContain("public.register_inventory_purchase");
    expect(probe).toContain("public.complete_production_batch");
    expect(probe).toContain("'WASTE', '1'");
    expect(probe).toContain("'SALE', -1");
    expect(probe).toContain("'ROLLBACK', 1");
    expect(probe).toContain("month but not report day");
    expect(probe).toContain("day_start - interval '1 second'");
    expect(probe).toContain("(SELECT day_start FROM t069_clock)");
    expect(probe).toContain("(SELECT day_end FROM t069_clock)");
    expect(probe).toContain(
      "transaction-time inventory or production labels were not preserved",
    );
    expect(probe).toContain("report unexpectedly mutated persisted data");
  });
});
