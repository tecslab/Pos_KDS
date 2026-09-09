import { describe, expect, it, vi } from "vitest";

import {
  REPORTING_TIME_ZONE,
  type DailySalesReportQuery,
} from "../../application";
import { SupabaseOperationalPerformanceReportReader } from "./supabase-operational-performance-report-reader";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const query: DailySalesReportQuery = {
  actorId,
  restaurantId,
  date: "2026-09-06",
  timeZone: REPORTING_TIME_ZONE,
  periodStart: "2026-09-06T05:00:00.000Z",
  periodEnd: "2026-09-07T05:00:00.000Z",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    restaurant_id: restaurantId,
    restaurant_name: "Carnales",
    report_date_result: "2026-09-06",
    reporting_timezone_result: REPORTING_TIME_ZONE,
    period_start: "2026-09-06T05:00:00+00:00",
    period_end: "2026-09-07T05:00:00+00:00",
    product_sales: [
      {
        product_id: "20000000-0000-4000-8000-000000000001",
        product_name: "Taco",
        quantity_sold: "2",
        revenue: "10",
      },
    ],
    category_sales: [
      {
        category_id: null,
        category_name: "Unattributed historical category",
        quantity_sold: 2,
        revenue: "10.00",
      },
    ],
    average_preparation_minutes: "12.5",
    longest_preparation_minutes: "20",
    orders_currently_in_preparation: "1",
    peak_preparation_periods: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      orders: hour === 12 ? 2 : 0,
    })),
    average_ready_to_on_the_way_minutes: "3",
    average_on_the_way_to_delivered_minutes: "8",
    delivered_orders: 2,
    orders_waiting_for_delivery: 1,
    ...overrides,
  };
}
function clientWith(data: unknown[], error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc } as never, rpc };
}

describe("SupabaseOperationalPerformanceReportReader", () => {
  it("uses the service-role aggregate and keeps the immutable legacy category label", async () => {
    const { client, rpc } = clientWith([row()]);
    const result = await new SupabaseOperationalPerformanceReportReader(
      client,
    ).read(query);
    expect(rpc).toHaveBeenCalledWith("read_operational_performance_report", {
      actor_user_id: actorId,
      target_restaurant_id: restaurantId,
      report_date: "2026-09-06",
      reporting_timezone: REPORTING_TIME_ZONE,
    });
    expect(result?.categorySales).toEqual([
      {
        categoryId: null,
        categoryName: "Unattributed historical category",
        quantitySold: 2,
        revenue: "10.00",
      },
    ]);
    expect(result?.productSales).toEqual([
      {
        productId: "20000000-0000-4000-8000-000000000001",
        productName: "Taco",
        quantitySold: 2,
        revenue: "10.00",
      },
    ]);
    expect(result?.peakPreparationPeriods).toHaveLength(24);
  });

  it("fails closed for malformed operational periods", async () => {
    const { client } = clientWith([row({ peak_preparation_periods: [] })]);
    await expect(
      new SupabaseOperationalPerformanceReportReader(client).read(query),
    ).rejects.toThrow("Daily sales report could not be read.");
  });

  it.each([
    ["orders_currently_in_preparation", null],
    ["delivered_orders", false],
    ["orders_waiting_for_delivery", " 1"],
    ["product_sales", [{ ...row().product_sales[0], quantity_sold: null }]],
    [
      "peak_preparation_periods",
      Array.from({ length: 24 }, (_, hour) => ({
        hour,
        orders: hour === 3 ? null : 0,
      })),
    ],
  ])("rejects unsupported count values in %s", async (field, value) => {
    const { client } = clientWith([row({ [field]: value })]);
    await expect(
      new SupabaseOperationalPerformanceReportReader(client).read(query),
    ).rejects.toThrow("Daily sales report could not be read.");
  });
});
