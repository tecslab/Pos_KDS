import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "./migrations/20260909090000_read_daily_sales_report/migration.sql",
  import.meta.url,
);

describe("daily sales report aggregate", () => {
  it("authorizes defensively and exposes the reader only to service_role", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain("permission.code = 'reports.view'");
    expect(sql).toContain("application_user.is_active = true");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toMatch(/REVOKE ALL[\s\S]+FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE[\s\S]+TO service_role/);
  });

  it("isolates every aggregate to one restaurant and half-open persisted timestamps", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql.match(/restaurant_id = target_restaurant_id/g)).toHaveLength(4);
    expect(sql).toContain("payment.recorded_at >= requested_period_start");
    expect(sql).toContain("payment.recorded_at < requested_period_end");
    expect(sql).toContain("sale_order.created_at >= requested_period_start");
    expect(sql).toContain("sale_order.created_at < requested_period_end");
    expect(sql).toContain("sale_order.paid_at >= requested_period_start");
    expect(sql).toContain("sale_order.paid_at < requested_period_end");
    expect(sql).not.toContain("CURRENT_DATE");
  });

  it("uses immutable payments, paid order totals, and all 24 local-hour buckets", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain("SUM(payment.amount)");
    expect(sql).toContain("AVG(sale_order.total_amount)");
    expect(sql).toContain("sale_order.paid_at");
    expect(sql).toContain("generate_series(0, 23)");
    expect(sql).toContain(
      "payment.recorded_at AT TIME ZONE reporting_timezone",
    );
  });
});
