import type { SupabaseClient } from "@supabase/supabase-js";

import {
  REPORTING_TIME_ZONE,
  type DailySalesReportQuery,
  type OperationalCategorySale,
  type OperationalPerformanceReport,
  type OperationalPerformanceReportReader,
  type OperationalProductSale,
} from "../../application";
import { DailySalesReportReadError } from "./supabase-daily-sales-report-reader";

export class SupabaseOperationalPerformanceReportReader implements OperationalPerformanceReportReader {
  constructor(private readonly client: SupabaseClient) {}

  async read(
    query: DailySalesReportQuery,
  ): Promise<OperationalPerformanceReport | null> {
    try {
      const { data, error } = await this.client.rpc(
        "read_operational_performance_report",
        {
          actor_user_id: query.actorId,
          target_restaurant_id: query.restaurantId,
          report_date: query.date,
          reporting_timezone: query.timeZone,
        },
      );
      if (error !== null) throw error;
      if (!Array.isArray(data) || data.length > 1) throw new Error();
      return data.length === 0 ? null : mapReport(data[0], query);
    } catch (error) {
      throw readError(error);
    }
  }
}

export function mapOperationalPerformanceReportRow(
  value: unknown,
  query: DailySalesReportQuery,
) {
  try {
    return mapReport(value, query);
  } catch {
    return null;
  }
}

function mapReport(
  value: unknown,
  query: DailySalesReportQuery,
): OperationalPerformanceReport {
  if (
    !record(value) ||
    value.restaurant_id !== query.restaurantId ||
    !nonblank(value.restaurant_name) ||
    value.report_date_result !== query.date ||
    value.reporting_timezone_result !== REPORTING_TIME_ZONE ||
    timestamp(value.period_start) !== query.periodStart ||
    timestamp(value.period_end) !== query.periodEnd
  )
    throw new Error();
  const productSales = mapSales(value.product_sales, true);
  const categorySales = mapSales(value.category_sales, false);
  const peakPreparationPeriods = mapHourly(value.peak_preparation_periods);
  const fields = [
    value.average_preparation_minutes,
    value.longest_preparation_minutes,
    value.average_ready_to_on_the_way_minutes,
    value.average_on_the_way_to_delivered_minutes,
  ].map(money);
  const counts = [
    value.orders_currently_in_preparation,
    value.delivered_orders,
    value.orders_waiting_for_delivery,
  ].map(count);
  if (
    !productSales ||
    !categorySales ||
    !peakPreparationPeriods ||
    fields.some((field) => field === null) ||
    counts.some((field) => field === null)
  )
    throw new Error();
  return Object.freeze({
    restaurant: Object.freeze({
      id: query.restaurantId,
      name: value.restaurant_name,
    }),
    date: query.date,
    timeZone: REPORTING_TIME_ZONE,
    periodStart: query.periodStart,
    periodEnd: query.periodEnd,
    productSales,
    categorySales,
    averagePreparationMinutes: fields[0]!,
    longestPreparationMinutes: fields[1]!,
    ordersCurrentlyInPreparation: counts[0]!,
    peakPreparationPeriods,
    averageReadyToOnTheWayMinutes: fields[2]!,
    averageOnTheWayToDeliveredMinutes: fields[3]!,
    deliveredOrders: counts[1]!,
    ordersWaitingForDelivery: counts[2]!,
  });
}

function mapSales(
  value: unknown,
  products: true,
): readonly OperationalProductSale[] | null;
function mapSales(
  value: unknown,
  products: false,
): readonly OperationalCategorySale[] | null;
function mapSales(value: unknown, products: boolean) {
  if (!Array.isArray(value)) return null;
  const result: Array<OperationalProductSale | OperationalCategorySale> = [];
  for (const entry of value) {
    if (
      !record(entry) ||
      (products && !nonblank(entry.product_name)) ||
      (!products && !nonblank(entry.category_name)) ||
      (!products && entry.category_id !== null && !uuid(entry.category_id)) ||
      !count(entry.quantity_sold) ||
      money(entry.revenue) === null ||
      (products && !uuid(entry.product_id))
    )
      return null;
    if (products) {
      result.push(
        Object.freeze({
          productId: entry.product_id as string,
          productName: entry.product_name as string,
          quantitySold: count(entry.quantity_sold)!,
          revenue: money(entry.revenue)!,
        }),
      );
    } else {
      result.push(
        Object.freeze({
          categoryId: entry.category_id as string | null,
          categoryName: entry.category_name as string,
          quantitySold: count(entry.quantity_sold)!,
          revenue: money(entry.revenue)!,
        }),
      );
    }
  }
  return Object.freeze(result) as
    readonly OperationalProductSale[] | readonly OperationalCategorySale[];
}

function mapHourly(value: unknown) {
  if (!Array.isArray(value) || value.length !== 24) return null;
  const result = value.map((entry, hour) => {
    if (
      !record(entry) ||
      count(entry.hour) !== hour ||
      count(entry.orders) === null
    )
      return null;
    return Object.freeze({ hour, orders: count(entry.orders)! });
  });
  return result.some((entry) => entry === null)
    ? null
    : Object.freeze(result as Array<{ hour: number; orders: number }>);
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
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
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
