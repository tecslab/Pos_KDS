import { err, ok, type Result } from "../../domain";
import {
  REPORTING_TIME_ZONE,
  parseDailySalesReportQuery,
  type DailySalesReportQuery,
} from "../daily-sales-report";

export const UNATTRIBUTED_HISTORICAL_CATEGORY =
  "Unattributed historical category";

export type OperationalProductSale = Readonly<{
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: string;
}>;

export type OperationalCategorySale = Readonly<{
  categoryId: string | null;
  categoryName: string;
  quantitySold: number;
  revenue: string;
}>;

export type OperationalHourlyCount = Readonly<{ hour: number; orders: number }>;

export type OperationalPerformanceReport = Readonly<{
  restaurant: Readonly<{ id: string; name: string }>;
  date: string;
  timeZone: typeof REPORTING_TIME_ZONE;
  periodStart: string;
  periodEnd: string;
  productSales: readonly OperationalProductSale[];
  categorySales: readonly OperationalCategorySale[];
  averagePreparationMinutes: string;
  longestPreparationMinutes: string;
  ordersCurrentlyInPreparation: number;
  peakPreparationPeriods: readonly OperationalHourlyCount[];
  averageReadyToOnTheWayMinutes: string;
  averageOnTheWayToDeliveredMinutes: string;
  deliveredOrders: number;
  ordersWaitingForDelivery: number;
}>;

export type OperationalPerformanceReportInput = Readonly<{
  actorId: unknown;
  restaurantId: unknown;
  date: unknown;
  timeZone: unknown;
}>;

export interface OperationalPerformanceReportReader {
  read(
    query: DailySalesReportQuery,
  ): Promise<OperationalPerformanceReport | null>;
}

export type OperationalPerformanceReportError = Readonly<{
  kind: "operational-performance-report-error";
  code:
    | "INVALID_INPUT"
    | "RESTAURANT_NOT_FOUND"
    | "UNAUTHORIZED"
    | "OPERATION_FAILED";
}>;

export class OperationalPerformanceReportService {
  constructor(private readonly reader: OperationalPerformanceReportReader) {}

  async read(
    input: OperationalPerformanceReportInput,
  ): Promise<
    Result<OperationalPerformanceReport, OperationalPerformanceReportError>
  > {
    const query = parseDailySalesReportQuery(input);
    if (query === null) return failure("INVALID_INPUT");
    try {
      const report = await this.reader.read(query);
      if (report === null) return failure("RESTAURANT_NOT_FOUND");
      return isValidReport(report, query)
        ? ok(report)
        : failure("OPERATION_FAILED");
    } catch (error) {
      return failure(
        isUnauthorizedPersistenceError(error)
          ? "UNAUTHORIZED"
          : "OPERATION_FAILED",
      );
    }
  }
}

function isValidReport(
  report: OperationalPerformanceReport,
  query: DailySalesReportQuery,
) {
  return Boolean(
    report &&
    report.restaurant.id === query.restaurantId &&
    nonblank(report.restaurant.name) &&
    report.date === query.date &&
    report.timeZone === query.timeZone &&
    report.periodStart === query.periodStart &&
    report.periodEnd === query.periodEnd &&
    duration(report.averagePreparationMinutes) &&
    duration(report.longestPreparationMinutes) &&
    duration(report.averageReadyToOnTheWayMinutes) &&
    duration(report.averageOnTheWayToDeliveredMinutes) &&
    count(report.ordersCurrentlyInPreparation) &&
    count(report.deliveredOrders) &&
    count(report.ordersWaitingForDelivery) &&
    sales(report.productSales, true) &&
    sales(report.categorySales, false) &&
    Array.isArray(report.peakPreparationPeriods) &&
    report.peakPreparationPeriods.length === 24 &&
    report.peakPreparationPeriods.every(
      (bucket, hour) => bucket.hour === hour && count(bucket.orders),
    ),
  );
}

function sales(value: unknown, products: boolean): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((sale) => {
    if (!sale || typeof sale !== "object") return false;
    const item = sale as Record<string, unknown>;
    return (
      (!products || uuid(item.productId)) &&
      (!products || nonblank(item.productName)) &&
      (products ||
        ((item.categoryId === null || uuid(item.categoryId)) &&
          nonblank(item.categoryName))) &&
      count(item.quantitySold) &&
      money(item.revenue)
    );
  });
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function money(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d{2}$/.test(value);
}

function duration(value: unknown): value is string {
  return money(value);
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

function isUnauthorizedPersistenceError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (("code" in error && error.code === "42501") ||
      ("persistenceCode" in error && error.persistenceCode === "42501"))
  );
}

function failure(code: OperationalPerformanceReportError["code"]) {
  return err(
    Object.freeze({
      kind: "operational-performance-report-error" as const,
      code,
    }),
  );
}
