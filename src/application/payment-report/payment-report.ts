import { err, ok, type Result } from "../../domain";
import {
  REPORTING_TIME_ZONE,
  parseDailySalesReportQuery,
  type DailySalesReportQuery,
} from "../daily-sales-report";

export type PaymentMethodRevenue = Readonly<{
  paymentMethodCode: string;
  paymentMethodName: string;
  paymentCount: number;
  amount: string;
}>;

export type PaymentBalance = Readonly<{
  orderId: string;
  orderNumber: string;
  basketId: string;
  basketTotal: string;
  paidAmount: string;
  outstandingBalance: string;
}>;

export type PaymentReportHistoryEntry = Readonly<{
  id: string;
  orderId: string;
  orderNumber: string;
  basketId: string;
  amount: string;
  paymentMethodCode: string;
  paymentMethodName: string;
  recordedById: string;
  recordedAt: string;
  referenceNumber: string | null;
  comments: string | null;
  overageAuthorizedById: string | null;
  overageAuthorizedAt: string | null;
  overageReason: string | null;
}>;

export type PaymentReport = Readonly<{
  restaurant: Readonly<{ id: string; name: string }>;
  date: string;
  timeZone: typeof REPORTING_TIME_ZONE;
  periodStart: string;
  periodEnd: string;
  totalRevenue: string;
  totalOutstanding: string;
  revenueByMethod: readonly PaymentMethodRevenue[];
  outstandingBalances: readonly PaymentBalance[];
  partialPayments: readonly PaymentBalance[];
  paymentHistory: readonly PaymentReportHistoryEntry[];
}>;

export type PaymentReportInput = Readonly<{
  actorId: unknown;
  restaurantId: unknown;
  date: unknown;
  timeZone: unknown;
}>;

export interface PaymentReportReader {
  read(query: DailySalesReportQuery): Promise<PaymentReport | null>;
}

export type PaymentReportError = Readonly<{
  kind: "payment-report-error";
  code:
    | "INVALID_INPUT"
    | "RESTAURANT_NOT_FOUND"
    | "UNAUTHORIZED"
    | "OPERATION_FAILED";
}>;

export class PaymentReportService {
  constructor(private readonly reader: PaymentReportReader) {}

  async read(
    input: PaymentReportInput,
  ): Promise<Result<PaymentReport, PaymentReportError>> {
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

function isValidReport(report: PaymentReport, query: DailySalesReportQuery) {
  if (
    !report ||
    report.restaurant.id !== query.restaurantId ||
    !nonblank(report.restaurant.name) ||
    report.date !== query.date ||
    report.timeZone !== query.timeZone ||
    report.periodStart !== query.periodStart ||
    report.periodEnd !== query.periodEnd ||
    money(report.totalRevenue) === null ||
    money(report.totalOutstanding) === null ||
    !Array.isArray(report.revenueByMethod) ||
    !Array.isArray(report.outstandingBalances) ||
    !Array.isArray(report.partialPayments) ||
    !Array.isArray(report.paymentHistory)
  ) {
    return false;
  }

  const methods = new Set<string>();
  if (
    !report.revenueByMethod.every((method) => {
      const key = `${method.paymentMethodCode}\u0000${method.paymentMethodName}`;
      if (
        !nonblank(method.paymentMethodCode) ||
        !nonblank(method.paymentMethodName) ||
        !positiveCount(method.paymentCount) ||
        !positiveMoney(method.amount) ||
        methods.has(key)
      ) {
        return false;
      }
      methods.add(key);
      return true;
    }) ||
    sumMoney(report.revenueByMethod.map((method) => method.amount)) !==
      report.totalRevenue
  ) {
    return false;
  }

  const outstanding = new Map<string, PaymentBalance>();
  if (
    !report.outstandingBalances.every((balance) => {
      if (!validBalance(balance, false) || outstanding.has(balance.basketId)) {
        return false;
      }
      outstanding.set(balance.basketId, balance);
      return true;
    }) ||
    sumMoney(
      report.outstandingBalances.map((balance) => balance.outstandingBalance),
    ) !== report.totalOutstanding
  ) {
    return false;
  }

  const partials = new Set<string>();
  if (
    !report.partialPayments.every((balance) => {
      const source = outstanding.get(balance.basketId);
      if (
        !validBalance(balance, true) ||
        partials.has(balance.basketId) ||
        source === undefined ||
        !sameBalance(source, balance)
      ) {
        return false;
      }
      partials.add(balance.basketId);
      return true;
    })
  ) {
    return false;
  }

  const historyIds = new Set<string>();
  if (
    !report.paymentHistory.every((entry) => {
      if (!validHistoryEntry(entry, query) || historyIds.has(entry.id)) {
        return false;
      }
      historyIds.add(entry.id);
      return true;
    }) ||
    sumMoney(report.paymentHistory.map((entry) => entry.amount)) !==
      report.totalRevenue
  ) {
    return false;
  }
  return true;
}

function validBalance(balance: PaymentBalance, requiresPaid: boolean) {
  const total = money(balance.basketTotal);
  const paid = money(balance.paidAmount);
  const outstanding = money(balance.outstandingBalance);
  return Boolean(
    uuid(balance.orderId) &&
    nonblank(balance.orderNumber) &&
    uuid(balance.basketId) &&
    total !== null &&
    cents(total) > BigInt(0) &&
    paid !== null &&
    (!requiresPaid || cents(paid) > BigInt(0)) &&
    outstanding !== null &&
    cents(outstanding) > BigInt(0) &&
    cents(outstanding) ===
      (cents(total) > cents(paid) ? cents(total) - cents(paid) : BigInt(0)),
  );
}

function sameBalance(left: PaymentBalance, right: PaymentBalance) {
  return (
    left.orderId === right.orderId &&
    left.orderNumber === right.orderNumber &&
    left.basketId === right.basketId &&
    left.basketTotal === right.basketTotal &&
    left.paidAmount === right.paidAmount &&
    left.outstandingBalance === right.outstandingBalance
  );
}

function validHistoryEntry(
  entry: PaymentReportHistoryEntry,
  query: DailySalesReportQuery,
) {
  const recordedAt = timestamp(entry.recordedAt);
  const completeOverageEvidence =
    uuid(entry.overageAuthorizedById) &&
    timestamp(entry.overageAuthorizedAt) !== null &&
    nonblank(entry.overageReason);
  const noOverageEvidence =
    entry.overageAuthorizedById === null &&
    entry.overageAuthorizedAt === null &&
    entry.overageReason === null;
  return Boolean(
    uuid(entry.id) &&
    uuid(entry.orderId) &&
    nonblank(entry.orderNumber) &&
    uuid(entry.basketId) &&
    positiveMoney(entry.amount) &&
    nonblank(entry.paymentMethodCode) &&
    nonblank(entry.paymentMethodName) &&
    uuid(entry.recordedById) &&
    recordedAt !== null &&
    recordedAt >= Date.parse(query.periodStart) &&
    recordedAt < Date.parse(query.periodEnd) &&
    optionalText(entry.referenceNumber, 200) &&
    optionalText(entry.comments, 2_000) &&
    (completeOverageEvidence || noOverageEvidence),
  );
}

function money(value: unknown): string | null {
  return typeof value === "string" && /^\d+\.\d{2}$/.test(value) ? value : null;
}

function positiveMoney(value: unknown): value is string {
  const parsed = money(value);
  return parsed !== null && cents(parsed) > BigInt(0);
}

function sumMoney(values: readonly string[]) {
  const total = values.reduce((sum, value) => sum + cents(value), BigInt(0));
  const canonical = total.toString().padStart(3, "0");
  return `${canonical.slice(0, -2)}.${canonical.slice(-2)}`;
}

function cents(value: string) {
  return BigInt(value.replace(".", ""));
}

function positiveCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function optionalText(value: unknown, maximumLength: number) {
  return (
    value === null ||
    (typeof value === "string" && value.length <= maximumLength)
  );
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
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

function isUnauthorizedPersistenceError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (("code" in error && error.code === "42501") ||
      ("persistenceCode" in error && error.persistenceCode === "42501"))
  );
}

function failure(code: PaymentReportError["code"]) {
  return err(Object.freeze({ kind: "payment-report-error" as const, code }));
}
