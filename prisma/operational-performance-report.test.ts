import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const path = new URL(
  "./migrations/20260909100000_read_operational_performance_report/migration.sql",
  import.meta.url,
);

describe("operational performance report migration", () => {
  it("persists category snapshots for future sales and leaves legacy rows unattributed", async () => {
    const sql = await readFile(path, "utf8");
    expect(sql).toContain("ADD COLUMN category_id uuid");
    expect(sql).toContain("ADD COLUMN category_name text");
    expect(sql).toContain("capture_order_line_sale_snapshot_category");
    expect(sql).toContain("BEFORE INSERT ON public.order_line_sale_snapshots");
    expect(sql).toContain("'Unattributed historical category'");
    const reportSql = sql.slice(sql.indexOf("paid_current_lines AS"));
    expect(reportSql).not.toMatch(
      /paid_current_lines[\s\S]*JOIN public\.product_categories/,
    );
  });
  it("uses persisted lifecycle timestamps and service-role-only authorization", async () => {
    const sql = await readFile(path, "utf8");
    expect(sql).toContain("sale_order.ready_at - sale_order.created_at");
    expect(sql).toContain("sale_order.on_the_way_at - sale_order.ready_at");
    expect(sql).toContain("sale_order.delivered_at - sale_order.on_the_way_at");
    expect(sql).toContain("permission.code = 'reports.view'");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.read_operational_performance_report[\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.read_operational_performance_report[\s\S]+TO service_role/,
    );
  });

  it("aggregates multiple immutable versions of the same product identity", async () => {
    const sql = await readFile(path, "utf8");
    const productTotals = sql.slice(
      sql.indexOf("paid_current_lines AS"),
      sql.indexOf("products_json AS"),
    );
    expect(productTotals).toContain("version.product_id");
    expect(productTotals).toContain("GROUP BY snapshot.product_id");
    expect(productTotals).not.toContain("GROUP BY snapshot.product_version_id");
    expect(productTotals).toContain("array_agg(snapshot.product_name");
  });
});
