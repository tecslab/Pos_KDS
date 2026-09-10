import type { SupabaseClient } from "@supabase/supabase-js";

import {
  REPORTING_TIME_ZONE,
  type DailySalesReportQuery,
  type PaymentBalance,
  type PaymentMethodRevenue,
  type PaymentReport,
  type PaymentReportHistoryEntry,
  type PaymentReportReader,
} from "../../application";
import { DailySalesReportReadError } from "./supabase-daily-sales-report-reader";

export class SupabasePaymentReportReader implements PaymentReportReader {
  constructor(private readonly client: SupabaseClient) {}

  async read(query: DailySalesReportQuery): Promise<PaymentReport | null> {
    try {
      const { data, error } = await this.client.rpc("read_payment_report", {
        actor_user_id: query.actorId,
        target_restaurant_id: query.restaurantId,
        report_date: query.date,
        reporting_timezone: query.timeZone,
      });
      if (error !== null) throw error;
      if (!Array.isArray(data) || data.length > 1) throw new Error();
      return data.length === 0 ? null : mapReport(data[0], query);
    } catch (error) {
      throw readError(error);
    }
  }
}

export function mapPaymentReportRow(
  value: unknown,
  query: DailySalesReportQuery,
): PaymentReport | null {
  try {
    return mapReport(value, query);
  } catch {
    return null;
  }
}

function mapReport(
  value: unknown,
  query: DailySalesReportQuery,
): PaymentReport {
  if (
    !record(value) ||
    value.restaurant_id !== query.restaurantId ||
    !nonblank(value.restaurant_name) ||
    value.report_date_result !== query.date ||
    value.reporting_timezone_result !== REPORTING_TIME_ZONE ||
    timestamp(value.period_start) !== query.periodStart ||
    timestamp(value.period_end) !== query.periodEnd
  ) {
    throw new Error();
  }

  const totalRevenue = money(value.total_revenue);
  const totalOutstanding = money(value.total_outstanding);
  const revenueByMethod = mapRevenueByMethod(value.revenue_by_method);
  const outstandingBalances = mapBalances(value.outstanding_balances);
  const partialPayments = mapBalances(value.partial_payments);
  const paymentHistory = mapHistory(value.payment_history);
  if (
    totalRevenue === null ||
    totalOutstanding === null ||
    revenueByMethod === null ||
    outstandingBalances === null ||
    partialPayments === null ||
    paymentHistory === null
  ) {
    throw new Error();
  }

  return Object.freeze({
    restaurant: Object.freeze({
      id: query.restaurantId,
      name: value.restaurant_name,
    }),
    date: query.date,
    timeZone: REPORTING_TIME_ZONE,
    periodStart: query.periodStart,
    periodEnd: query.periodEnd,
    totalRevenue,
    totalOutstanding,
    revenueByMethod,
    outstandingBalances,
    partialPayments,
    paymentHistory,
  });
}

function mapRevenueByMethod(value: unknown) {
  if (!Array.isArray(value)) return null;
  const rows: PaymentMethodRevenue[] = [];
  for (const candidate of value) {
    if (
      !record(candidate) ||
      !nonblank(candidate.payment_method_code) ||
      !nonblank(candidate.payment_method_name)
    ) {
      return null;
    }
    const paymentCount = count(candidate.payment_count);
    const amount = money(candidate.amount);
    if (paymentCount === null || paymentCount === 0 || amount === null) {
      return null;
    }
    rows.push(
      Object.freeze({
        paymentMethodCode: candidate.payment_method_code,
        paymentMethodName: candidate.payment_method_name,
        paymentCount,
        amount,
      }),
    );
  }
  return Object.freeze(rows);
}

function mapBalances(value: unknown) {
  if (!Array.isArray(value)) return null;
  const rows: PaymentBalance[] = [];
  for (const candidate of value) {
    if (
      !record(candidate) ||
      !uuid(candidate.order_id) ||
      !nonblank(candidate.order_number) ||
      !uuid(candidate.basket_id)
    ) {
      return null;
    }
    const basketTotal = money(candidate.basket_total);
    const paidAmount = money(candidate.paid_amount);
    const outstandingBalance = money(candidate.outstanding_balance);
    if (
      basketTotal === null ||
      paidAmount === null ||
      outstandingBalance === null
    ) {
      return null;
    }
    rows.push(
      Object.freeze({
        orderId: candidate.order_id,
        orderNumber: candidate.order_number,
        basketId: candidate.basket_id,
        basketTotal,
        paidAmount,
        outstandingBalance,
      }),
    );
  }
  return Object.freeze(rows);
}

function mapHistory(value: unknown) {
  if (!Array.isArray(value)) return null;
  const rows: PaymentReportHistoryEntry[] = [];
  for (const candidate of value) {
    if (
      !record(candidate) ||
      !uuid(candidate.id) ||
      !uuid(candidate.order_id) ||
      !nonblank(candidate.order_number) ||
      !uuid(candidate.basket_id) ||
      !nonblank(candidate.payment_method_code) ||
      !nonblank(candidate.payment_method_name) ||
      !uuid(candidate.recorded_by_id) ||
      !optionalText(candidate.reference_number, 200) ||
      !optionalText(candidate.comments, 2_000) ||
      !nullableUuid(candidate.overage_authorized_by_id) ||
      !optionalText(candidate.overage_reason, 1_000)
    ) {
      return null;
    }
    const amount = money(candidate.amount);
    const recordedAt = timestamp(candidate.recorded_at);
    const overageAuthorizedAt = nullableTimestamp(
      candidate.overage_authorized_at,
    );
    if (
      amount === null ||
      recordedAt === null ||
      overageAuthorizedAt === false
    ) {
      return null;
    }
    rows.push(
      Object.freeze({
        id: candidate.id,
        orderId: candidate.order_id,
        orderNumber: candidate.order_number,
        basketId: candidate.basket_id,
        amount,
        paymentMethodCode: candidate.payment_method_code,
        paymentMethodName: candidate.payment_method_name,
        recordedById: candidate.recorded_by_id,
        recordedAt,
        referenceNumber: candidate.reference_number as string | null,
        comments: candidate.comments as string | null,
        overageAuthorizedById: candidate.overage_authorized_by_id as
          string | null,
        overageAuthorizedAt,
        overageReason: candidate.overage_reason as string | null,
      }),
    );
  }
  return Object.freeze(rows);
}

function money(value: unknown): string | null {
  const match =
    (typeof value === "string" || typeof value === "number") &&
    /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  return match
    ? `${match[1].replace(/^0+(?=\d)/, "")}.${(match[2] ?? "").padEnd(2, "0")}`
    : null;
}

function count(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return null;
  }
  return new Date(value).toISOString();
}

function nullableTimestamp(value: unknown): string | null | false {
  return value === null ? null : (timestamp(value) ?? false);
}

function optionalText(value: unknown, maximumLength: number) {
  return (
    value === null ||
    (typeof value === "string" && value.length <= maximumLength)
  );
}

function nullableUuid(value: unknown): value is string | null {
  return value === null || uuid(value);
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readError(error: unknown) {
  return new DailySalesReportReadError(
    record(error) && typeof error.code === "string" ? error.code : undefined,
  );
}
