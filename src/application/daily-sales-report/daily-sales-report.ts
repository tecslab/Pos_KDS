import { err, ok, type Result } from "../../domain";

export const REPORTING_TIME_ZONE = "America/Guayaquil";

export type DailySalesReportRestaurant = Readonly<{
  id: string;
  name: string;
}>;

export type HourlyRevenue = Readonly<{
  hour: number;
  amount: string;
}>;

export type DailySalesReport = Readonly<{
  restaurant: DailySalesReportRestaurant;
  date: string;
  timeZone: typeof REPORTING_TIME_ZONE;
  periodStart: string;
  periodEnd: string;
  totalRevenue: string;
  ordersCreated: number;
  ordersCompleted: number;
  averageTicket: string;
  hourlyRevenue: readonly HourlyRevenue[];
}>;

export type DailySalesReportQuery = Readonly<{
  actorId: string;
  restaurantId: string;
  date: string;
  timeZone: typeof REPORTING_TIME_ZONE;
  periodStart: string;
  periodEnd: string;
}>;

export type DailySalesReportInput = Readonly<{
  actorId: unknown;
  restaurantId: unknown;
  date: unknown;
  timeZone: unknown;
}>;

export interface DailySalesReportReader {
  listRestaurants(): Promise<readonly DailySalesReportRestaurant[]>;
  read(query: DailySalesReportQuery): Promise<DailySalesReport | null>;
}

export type DailySalesReportError = Readonly<{
  kind: "daily-sales-report-error";
  code:
    | "INVALID_INPUT"
    | "RESTAURANT_NOT_FOUND"
    | "UNAUTHORIZED"
    | "OPERATION_FAILED";
}>;

export class DailySalesReportService {
  constructor(private readonly reader: DailySalesReportReader) {}

  async listRestaurants(): Promise<
    Result<readonly DailySalesReportRestaurant[], DailySalesReportError>
  > {
    try {
      const restaurants = await this.reader.listRestaurants();
      if (!isRestaurantList(restaurants)) return failure("OPERATION_FAILED");
      return ok(Object.freeze([...restaurants]));
    } catch {
      return failure("OPERATION_FAILED");
    }
  }

  async read(
    input: DailySalesReportInput,
  ): Promise<Result<DailySalesReport, DailySalesReportError>> {
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

export function parseDailySalesReportQuery(
  input: DailySalesReportInput,
): DailySalesReportQuery | null {
  if (
    !isUuid(input.actorId) ||
    !isUuid(input.restaurantId) ||
    typeof input.date !== "string" ||
    typeof input.timeZone !== "string" ||
    input.timeZone !== REPORTING_TIME_ZONE
  ) {
    return null;
  }
  const period = resolveGuayaquilDay(input.date);
  if (period === null) return null;
  return Object.freeze({
    actorId: input.actorId,
    restaurantId: input.restaurantId,
    date: input.date,
    timeZone: REPORTING_TIME_ZONE,
    ...period,
  });
}

export function currentGuayaquilDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function resolveGuayaquilDay(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1 ||
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return null;
  }
  const nextCalendarDate = new Date(Date.UTC(year, month - 1, day + 1));
  const periodStart = zonedMidnight(year, month, day);
  const periodEnd = zonedMidnight(
    nextCalendarDate.getUTCFullYear(),
    nextCalendarDate.getUTCMonth() + 1,
    nextCalendarDate.getUTCDate(),
  );
  return Object.freeze({
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  });
}

function zonedMidnight(year: number, month: number, day: number) {
  const desiredLocalFieldsAsUtc = Date.UTC(year, month - 1, day);
  let instant = desiredLocalFieldsAsUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Resolve the IANA offset at the requested local date instead of relying on
  // the machine timezone or assuming that timezone rules never change.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value]),
    );
    const representedLocalFieldsAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const nextInstant =
      desiredLocalFieldsAsUtc - (representedLocalFieldsAsUtc - instant);
    if (nextInstant === instant) break;
    instant = nextInstant;
  }
  return new Date(instant);
}

function isValidReport(report: DailySalesReport, query: DailySalesReportQuery) {
  if (
    !report ||
    report.restaurant.id !== query.restaurantId ||
    !isNonblank(report.restaurant.name) ||
    report.date !== query.date ||
    report.timeZone !== query.timeZone ||
    report.periodStart !== query.periodStart ||
    report.periodEnd !== query.periodEnd ||
    money(report.totalRevenue) === null ||
    money(report.averageTicket) === null ||
    !Number.isSafeInteger(report.ordersCreated) ||
    report.ordersCreated < 0 ||
    !Number.isSafeInteger(report.ordersCompleted) ||
    report.ordersCompleted < 0 ||
    !Array.isArray(report.hourlyRevenue) ||
    report.hourlyRevenue.length !== 24
  ) {
    return false;
  }
  return report.hourlyRevenue.every(
    (bucket, index) => bucket.hour === index && money(bucket.amount) !== null,
  );
}

function isRestaurantList(value: readonly DailySalesReportRestaurant[]) {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((restaurant) => {
    if (
      !restaurant ||
      !isUuid(restaurant.id) ||
      !isNonblank(restaurant.name) ||
      ids.has(restaurant.id)
    ) {
      return false;
    }
    ids.add(restaurant.id);
    return true;
  });
}

function money(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) return null;
  return value;
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

function isUnauthorizedPersistenceError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (("code" in error && error.code === "42501") ||
      ("persistenceCode" in error && error.persistenceCode === "42501"))
  );
}

function failure(code: DailySalesReportError["code"]) {
  return err(
    Object.freeze({ kind: "daily-sales-report-error" as const, code }),
  );
}
