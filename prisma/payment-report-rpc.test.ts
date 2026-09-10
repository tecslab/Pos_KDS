import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "./migrations/20260910090000_read_payment_report/migration.sql",
  import.meta.url,
);
const historicalBalanceRepairUrl = new URL(
  "./migrations/20260910100000_preserve_payment_report_historical_balances/migration.sql",
  import.meta.url,
);
const probeUrl = new URL(
  "./probes/T-068-payment-report-probes.sql",
  import.meta.url,
);

describe("payment report aggregate", () => {
  it("uses reports.view defense in depth and service-role-only execution", async () => {
    const sql = await readFile(historicalBalanceRepairUrl, "utf8");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toContain("application_user.is_active = true");
    expect(sql).toContain("permission.code = 'reports.view'");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.read_payment_report[\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.read_payment_report[\s\S]+TO service_role/,
    );
  });

  it("scopes immutable payment views to one restaurant and the half-open Guayaquil day", async () => {
    const sql = await readFile(historicalBalanceRepairUrl, "utf8");
    expect(sql).toContain("payment.recorded_at >= requested_period_start");
    expect(sql).toContain("payment.recorded_at < requested_period_end");
    expect(sql).toContain("payment.restaurant_id = target_restaurant_id");
    expect(sql).toContain("line.restaurant_id = target_restaurant_id");
    expect(sql).toContain(
      "reporting_timezone IS DISTINCT FROM 'America/Guayaquil'",
    );
    expect(sql).not.toContain("CURRENT_DATE");
  });

  it("uses payment snapshots and reconstructs end-of-day outstanding and partial balances", async () => {
    const initialSql = await readFile(migrationUrl, "utf8");
    const sql = await readFile(historicalBalanceRepairUrl, "utf8");
    expect(initialSql).toContain(
      "CREATE OR REPLACE FUNCTION public.read_payment_report",
    );
    expect(sql).toContain("payment.payment_method_code");
    expect(sql).toContain("payment.payment_method_name");
    expect(sql).toContain("active_line_snapshots_at_period_end AS");
    expect(sql).toContain("snapshot.created_at < requested_period_end");
    expect(sql).toContain("snapshot.revision_number DESC");
    expect(sql).toContain("removal.removed_at < requested_period_end");
    expect(sql).toContain("historical_basket_totals AS");
    expect(sql).toContain("balances_as_of_period_end AS");
    expect(sql).toContain("payment.recorded_at < requested_period_end");
    expect(sql).toContain("cancellation.cancelled_at < requested_period_end");
    expect(sql).toContain("WHERE balance.paid_amount > 0");
    expect(sql).toContain("payment.overage_authorized_by_id");
    expect(sql).toContain("payment.overage_reason");
    const historicalBalanceSql = sql.slice(
      sql.indexOf("active_line_snapshots_at_period_end AS"),
      sql.indexOf("outstanding AS"),
    );
    expect(historicalBalanceSql).not.toContain("basket.total_amount");
  });

  it("ships rollback-only behavior coverage for authorization, history, and balances", async () => {
    const probe = await readFile(probeUrl, "utf8");
    expect(probe).toContain("BEGIN;");
    expect(probe.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    expect(probe).toContain("SELECT * FROM public.read_payment_report");
    expect(probe).toContain("expected reports.view denial");
    expect(probe).toContain("payment method snapshot was not preserved");
    expect(probe).toContain(
      "post-cutoff modification changed the historical balance",
    );
    expect(probe).toContain(
      "payment report unexpectedly mutated persisted data",
    );
  });
});
