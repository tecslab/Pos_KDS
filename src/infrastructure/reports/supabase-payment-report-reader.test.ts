import { describe, expect, it, vi } from "vitest";

import {
  REPORTING_TIME_ZONE,
  type DailySalesReportQuery,
} from "../../application";
import { SupabasePaymentReportReader } from "./supabase-payment-report-reader";

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

function balance() {
  return {
    order_id: "40000000-0000-4000-8000-000000000001",
    order_number: "ORD-001",
    basket_id: "50000000-0000-4000-8000-000000000001",
    basket_total: "20",
    paid_amount: "5.0",
    outstanding_balance: 15,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    restaurant_id: restaurantId,
    restaurant_name: "Carnales",
    report_date_result: "2026-09-06",
    reporting_timezone_result: REPORTING_TIME_ZONE,
    period_start: "2026-09-06T05:00:00+00:00",
    period_end: "2026-09-07T05:00:00+00:00",
    total_revenue: "10",
    total_outstanding: "15.00",
    revenue_by_method: [
      {
        payment_method_code: "CASH",
        payment_method_name: "Efectivo",
        payment_count: "1",
        amount: "10",
      },
    ],
    outstanding_balances: [balance()],
    partial_payments: [balance()],
    payment_history: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        order_id: "40000000-0000-4000-8000-000000000002",
        order_number: "ORD-002",
        basket_id: "50000000-0000-4000-8000-000000000002",
        amount: "10.0",
        payment_method_code: "CASH",
        payment_method_name: "Efectivo",
        recorded_by_id: actorId,
        recorded_at: "2026-09-06T18:00:00+00:00",
        reference_number: "REF-1",
        comments: null,
        overage_authorized_by_id: null,
        overage_authorized_at: null,
        overage_reason: null,
      },
    ],
    ...overrides,
  };
}

function clientWith(data: unknown[], error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc } as never, rpc };
}

describe("SupabasePaymentReportReader", () => {
  it("calls the service-role RPC and maps all persisted payment views", async () => {
    const { client, rpc } = clientWith([row()]);
    const result = await new SupabasePaymentReportReader(client).read(query);
    expect(rpc).toHaveBeenCalledWith("read_payment_report", {
      actor_user_id: actorId,
      target_restaurant_id: restaurantId,
      report_date: "2026-09-06",
      reporting_timezone: REPORTING_TIME_ZONE,
    });
    expect(result).toMatchObject({
      totalRevenue: "10.00",
      totalOutstanding: "15.00",
      revenueByMethod: [{ amount: "10.00", paymentCount: 1 }],
      outstandingBalances: [{ outstandingBalance: "15.00" }],
      partialPayments: [{ paidAmount: "5.00" }],
      paymentHistory: [
        { recordedAt: "2026-09-06T18:00:00.000Z", referenceNumber: "REF-1" },
      ],
    });
  });

  it.each([
    [
      "revenue_by_method",
      [{ ...row().revenue_by_method[0], payment_count: 0 }],
    ],
    ["outstanding_balances", [{ ...balance(), basket_id: "bad" }]],
    ["partial_payments", false],
    [
      "payment_history",
      [{ ...row().payment_history[0], recorded_at: "not-a-date" }],
    ],
  ])("fails closed for malformed %s", async (field, value) => {
    const { client } = clientWith([row({ [field]: value })]);
    await expect(
      new SupabasePaymentReportReader(client).read(query),
    ).rejects.toThrow("Daily sales report could not be read.");
  });

  it("preserves authorization error codes from the persistence boundary", async () => {
    const { client } = clientWith([], { code: "42501" });
    await expect(
      new SupabasePaymentReportReader(client).read(query),
    ).rejects.toMatchObject({ persistenceCode: "42501" });
  });
});
