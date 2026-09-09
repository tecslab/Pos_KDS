import type { SupabaseClient } from "@supabase/supabase-js";

import {
  REPORTING_TIME_ZONE,
  type DailySalesReport,
  type DailySalesReportQuery,
  type DailySalesReportReader,
  type DailySalesReportRestaurant,
  type HourlyRevenue,
} from "../../application";

export class DailySalesReportReadError extends Error {
  constructor(readonly persistenceCode?: string) {
    super("Daily sales report could not be read.");
    this.name = "DailySalesReportReadError";
  }
}

export class SupabaseDailySalesReportReader implements DailySalesReportReader {
  constructor(private readonly client: SupabaseClient) {}

  async listRestaurants(): Promise<readonly DailySalesReportRestaurant[]> {
    try {
      const { data, error } = await this.client
        .from("restaurants")
        .select("id, name")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("name", { ascending: true })
        .order("id", { ascending: true });
      if (error !== null || !Array.isArray(data)) throw error;
      return Object.freeze(data.map(mapRestaurant));
    } catch (error) {
      throw readError(error);
    }
  }

  async read(query: DailySalesReportQuery): Promise<DailySalesReport | null> {
    try {
      const { data, error } = await this.client.rpc("read_daily_sales_report", {
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

function mapRestaurant(value: unknown): DailySalesReportRestaurant {
  if (!isRecord(value) || !isUuid(value.id) || !isNonblank(value.name)) {
    throw new Error();
  }
  return Object.freeze({ id: value.id, name: value.name });
}

export function mapDailySalesReportRow(
  value: unknown,
  query: DailySalesReportQuery,
): DailySalesReport | null {
  try {
    return mapReport(value, query);
  } catch {
    return null;
  }
}

function mapReport(
  value: unknown,
  query: DailySalesReportQuery,
): DailySalesReport {
  if (
    !isRecord(value) ||
    value.restaurant_id !== query.restaurantId ||
    !isNonblank(value.restaurant_name) ||
    value.report_date_result !== query.date ||
    value.reporting_timezone_result !== REPORTING_TIME_ZONE ||
    timestamp(value.period_start) !== query.periodStart ||
    timestamp(value.period_end) !== query.periodEnd
  ) {
    throw new Error();
  }
  const totalRevenue = money(value.total_revenue);
  const averageTicket = money(value.average_ticket);
  const ordersCreated = count(value.orders_created);
  const ordersCompleted = count(value.orders_completed);
  const hourlyRevenue = mapHourlyRevenue(value.hourly_revenue);
  if (
    totalRevenue === null ||
    averageTicket === null ||
    ordersCreated === null ||
    ordersCompleted === null ||
    hourlyRevenue === null
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
    ordersCreated,
    ordersCompleted,
    averageTicket,
    hourlyRevenue,
  });
}

function mapHourlyRevenue(value: unknown): readonly HourlyRevenue[] | null {
  if (!Array.isArray(value) || value.length !== 24) return null;
  const buckets: HourlyRevenue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    if (!isRecord(candidate) || count(candidate.hour) !== index) return null;
    const amount = money(candidate.amount);
    if (amount === null) return null;
    buckets.push(Object.freeze({ hour: index, amount }));
  }
  return Object.freeze(buckets);
}

function money(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (match === null) return null;
  return `${match[1].replace(/^0+(?=\d)/, "")}.${(match[2] ?? "").padEnd(2, "0")}`;
}

function count(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return null;
  }
  return new Date(value).toISOString();
}

function readError(error: unknown) {
  const code =
    isRecord(error) && typeof error.code === "string" ? error.code : undefined;
  return new DailySalesReportReadError(code);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
