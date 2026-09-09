import { describe, expect, it, vi } from "vitest";

import {
  REPORTING_TIME_ZONE,
  type DailySalesReportQuery,
} from "../../application";
import { SupabaseDailySalesReportReader } from "./supabase-daily-sales-report-reader";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const query: DailySalesReportQuery = Object.freeze({
  actorId,
  restaurantId,
  date: "2026-09-06",
  timeZone: REPORTING_TIME_ZONE,
  periodStart: "2026-09-06T05:00:00.000Z",
  periodEnd: "2026-09-07T05:00:00.000Z",
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    restaurant_id: restaurantId,
    restaurant_name: "Carnales Centro",
    report_date_result: "2026-09-06",
    reporting_timezone_result: REPORTING_TIME_ZONE,
    period_start: "2026-09-06T05:00:00+00:00",
    period_end: "2026-09-07T05:00:00+00:00",
    total_revenue: "37.5",
    orders_created: 5,
    orders_completed: "2",
    average_ticket: "18.75",
    hourly_revenue: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      amount: hour === 23 ? "37.50" : "0.00",
    })),
    ...overrides,
  };
}

function clientWith(data: unknown[], error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc } as never, rpc };
}

describe("SupabaseDailySalesReportReader", () => {
  it("calls the aggregate for exactly the actor, restaurant, date, and approved timezone", async () => {
    const { client, rpc } = clientWith([row()]);

    await expect(
      new SupabaseDailySalesReportReader(client).read(query),
    ).resolves.toEqual({
      restaurant: { id: restaurantId, name: "Carnales Centro" },
      date: "2026-09-06",
      timeZone: REPORTING_TIME_ZONE,
      periodStart: "2026-09-06T05:00:00.000Z",
      periodEnd: "2026-09-07T05:00:00.000Z",
      totalRevenue: "37.50",
      ordersCreated: 5,
      ordersCompleted: 2,
      averageTicket: "18.75",
      hourlyRevenue: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        amount: hour === 23 ? "37.50" : "0.00",
      })),
    });
    expect(rpc).toHaveBeenCalledWith("read_daily_sales_report", {
      actor_user_id: actorId,
      target_restaurant_id: restaurantId,
      report_date: "2026-09-06",
      reporting_timezone: REPORTING_TIME_ZONE,
    });
  });

  it("returns not found for no active matching restaurant", async () => {
    const { client } = clientWith([]);
    await expect(
      new SupabaseDailySalesReportReader(client).read(query),
    ).resolves.toBeNull();
  });

  it("fails closed when persistence mixes restaurants or omits an hourly bucket", async () => {
    for (const invalid of [
      row({ restaurant_id: "30000000-0000-4000-8000-000000000099" }),
      row({ hourly_revenue: row().hourly_revenue.slice(1) }),
    ]) {
      const { client } = clientWith([invalid]);
      await expect(
        new SupabaseDailySalesReportReader(client).read(query),
      ).rejects.toThrow("Daily sales report could not be read.");
    }
  });

  it("retains only the safe persistence code for authorization mapping", async () => {
    const { client } = clientWith([], {
      code: "42501",
      message: "private database details",
    });
    await expect(
      new SupabaseDailySalesReportReader(client).read(query),
    ).rejects.toMatchObject({ persistenceCode: "42501" });
  });
});
