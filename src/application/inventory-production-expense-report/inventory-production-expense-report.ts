import { err, ok, type Result } from "../../domain";
import {
  REPORTING_TIME_ZONE,
  parseDailySalesReportQuery,
  type DailySalesReportQuery,
} from "../daily-sales-report";

export const INVENTORY_MOVEMENT_TYPES = Object.freeze([
  "PURCHASE",
  "PRODUCTION_CONSUMPTION",
  "PRODUCTION_OUTPUT",
  "SALE",
  "ADJUSTMENT",
  "WASTE",
  "ROLLBACK",
] as const);

export type InventoryReportBalance = Readonly<{
  inventoryItemId: string;
  inventoryItemName: string;
  inventoryItemType: string;
  unitOfMeasure: string;
  minimumStockLevel: string;
  currentBalance: string;
  isBelowMinimum: boolean;
}>;

export type InventoryReportAlert = Readonly<{
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  unitOfMeasure: string;
  threshold: string;
  observedBalance: string;
  openedAt: string;
}>;

export type InventoryReportMovement = Readonly<{
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  type: (typeof INVENTORY_MOVEMENT_TYPES)[number];
  quantityDelta: string;
  unitOfMeasure: string;
  recordedById: string;
  recordedAt: string;
  businessOriginType: string;
  businessOriginId: string;
  comments: string | null;
  reversedMovementId: string | null;
}>;

export type InventoryReportPurchaseLine = Readonly<{
  inventoryItemId: string;
  inventoryItemName: string;
  inventoryMovementId: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  lineTotal: string;
}>;

export type InventoryReportPurchase = Readonly<{
  id: string;
  operatingExpenseId: string;
  expenseCategoryCode: string;
  expenseCategoryName: string;
  recordedById: string;
  supplierName: string | null;
  referenceNumber: string | null;
  comments: string | null;
  totalAmount: string;
  recordedAt: string;
  lines: readonly InventoryReportPurchaseLine[];
}>;

export type InventoryReportProductionBatch = Readonly<{
  id: string;
  recipeVersionId: string;
  recipeVersionNumber: number;
  recipeName: string;
  outputInventoryItemId: string;
  outputInventoryItemName: string;
  producedQuantity: string;
  unitOfMeasure: string;
  completedById: string;
  completedAt: string;
  notes: string | null;
}>;

export type InventoryReportCorrection = Readonly<{
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  inventoryMovementId: string;
  quantity: string;
  unitOfMeasure: string;
  reason: string;
  recordedById: string;
  recordedAt: string;
}>;

export type ExpenseReportEntry = Readonly<{
  id: string;
  amount: string;
  description: string;
  incurredAt: string;
  recordedAt: string;
  recordedById: string;
  referenceNumber: string | null;
  comments: string | null;
  expenseCategoryCode: string;
  expenseCategoryName: string;
  originType: "MANUAL" | "PURCHASE";
  originId: string | null;
}>;

export type ExpenseCategoryTotal = Readonly<{
  expenseCategoryCode: string;
  expenseCategoryName: string;
  amount: string;
}>;

export type ExpenseDailyTotal = Readonly<{ date: string; amount: string }>;

export type InventoryProductionExpenseReport = Readonly<{
  restaurant: Readonly<{ id: string; name: string }>;
  date: string;
  timeZone: typeof REPORTING_TIME_ZONE;
  periodStart: string;
  periodEnd: string;
  monthStart: string;
  monthEnd: string;
  inventoryBalances: readonly InventoryReportBalance[];
  activeAlerts: readonly InventoryReportAlert[];
  movements: readonly InventoryReportMovement[];
  purchases: readonly InventoryReportPurchase[];
  productionBatches: readonly InventoryReportProductionBatch[];
  adjustments: readonly InventoryReportCorrection[];
  wasteRecords: readonly InventoryReportCorrection[];
  expenses: readonly ExpenseReportEntry[];
  dailyExpenseTotal: string;
  monthlyExpenseTotal: string;
  dailyExpensesByCategory: readonly ExpenseCategoryTotal[];
  monthlyExpensesByCategory: readonly ExpenseCategoryTotal[];
  monthlyExpensesByDay: readonly ExpenseDailyTotal[];
}>;

export type InventoryProductionExpenseReportInput = Readonly<{
  actorId: unknown;
  restaurantId: unknown;
  date: unknown;
  timeZone: unknown;
}>;

export interface InventoryProductionExpenseReportReader {
  read(
    query: DailySalesReportQuery,
  ): Promise<InventoryProductionExpenseReport | null>;
}

export type InventoryProductionExpenseReportError = Readonly<{
  kind: "inventory-production-expense-report-error";
  code:
    | "INVALID_INPUT"
    | "RESTAURANT_NOT_FOUND"
    | "UNAUTHORIZED"
    | "OPERATION_FAILED";
}>;

export class InventoryProductionExpenseReportService {
  constructor(
    private readonly reader: InventoryProductionExpenseReportReader,
  ) {}

  async read(
    input: InventoryProductionExpenseReportInput,
  ): Promise<
    Result<
      InventoryProductionExpenseReport,
      InventoryProductionExpenseReportError
    >
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
  report: InventoryProductionExpenseReport,
  query: DailySalesReportQuery,
) {
  const month = expectedMonth(query);
  if (
    !report ||
    report.restaurant.id !== query.restaurantId ||
    !nonblank(report.restaurant.name) ||
    report.date !== query.date ||
    report.timeZone !== query.timeZone ||
    report.periodStart !== query.periodStart ||
    report.periodEnd !== query.periodEnd ||
    month === null ||
    report.monthStart !== month.start ||
    report.monthEnd !== month.end ||
    !unique(report.inventoryBalances, (row) => row.inventoryItemId, balance) ||
    !unique(report.activeAlerts, (row) => row.id, alert) ||
    !unique(report.movements, (row) => row.id, movement) ||
    !unique(report.purchases, (row) => row.id, purchase) ||
    !unique(report.productionBatches, (row) => row.id, productionBatch) ||
    !unique(report.adjustments, (row) => row.id, correction) ||
    !unique(report.wasteRecords, (row) => row.id, correction) ||
    !unique(report.expenses, (row) => row.id, expense) ||
    !money(report.dailyExpenseTotal) ||
    !money(report.monthlyExpenseTotal) ||
    !categoryTotals(report.dailyExpensesByCategory) ||
    !categoryTotals(report.monthlyExpensesByCategory) ||
    !monthlyDays(report.monthlyExpensesByDay, query.date.slice(0, 7))
  ) {
    return false;
  }

  return (
    report.inventoryBalances.every(
      (entry) =>
        entry.isBelowMinimum ===
        Number(entry.currentBalance) < Number(entry.minimumStockLevel),
    ) &&
    report.activeAlerts.every(
      (entry) => Number(entry.observedBalance) < Number(entry.threshold),
    ) &&
    report.movements.every(
      (entry) => within(entry.recordedAt, query) && validMovementOrigin(entry),
    ) &&
    report.purchases.every((entry) => within(entry.recordedAt, query)) &&
    report.productionBatches.every((entry) =>
      within(entry.completedAt, query),
    ) &&
    report.adjustments.every((entry) => within(entry.recordedAt, query)) &&
    report.wasteRecords.every((entry) => within(entry.recordedAt, query)) &&
    report.expenses.every((entry) => within(entry.incurredAt, query)) &&
    sumMoney(report.expenses.map((entry) => entry.amount)) ===
      report.dailyExpenseTotal &&
    sumMoney(report.dailyExpensesByCategory.map((entry) => entry.amount)) ===
      report.dailyExpenseTotal &&
    sumMoney(report.monthlyExpensesByCategory.map((entry) => entry.amount)) ===
      report.monthlyExpenseTotal &&
    sumMoney(report.monthlyExpensesByDay.map((entry) => entry.amount)) ===
      report.monthlyExpenseTotal &&
    categoryDetailMatches(report.expenses, report.dailyExpensesByCategory) &&
    report.purchases.every(
      (entry) =>
        entry.lines.every((line) =>
          report.movements.some(
            (movement) =>
              movement.id === line.inventoryMovementId &&
              movement.businessOriginType === "PURCHASE" &&
              movement.businessOriginId === entry.id &&
              movement.inventoryItemId === line.inventoryItemId &&
              movement.quantityDelta === line.quantity &&
              movement.unitOfMeasure === line.unitOfMeasure,
          ),
        ) &&
        report.expenses.some(
          (expense) =>
            expense.id === entry.operatingExpenseId &&
            expense.originType === "PURCHASE" &&
            expense.originId === entry.id &&
            expense.amount === entry.totalAmount &&
            expense.expenseCategoryCode === entry.expenseCategoryCode &&
            expense.expenseCategoryName === entry.expenseCategoryName,
        ),
    ) &&
    report.adjustments.every((entry) =>
      matchesCorrection(entry, report.movements, "ADJUSTMENT", false),
    ) &&
    report.wasteRecords.every((entry) =>
      matchesCorrection(entry, report.movements, "WASTE", true),
    ) &&
    report.productionBatches.every(
      (batch) =>
        report.movements.some(
          (movement) =>
            movement.businessOriginType === "PRODUCTION" &&
            movement.businessOriginId === batch.id &&
            movement.type === "PRODUCTION_OUTPUT" &&
            movement.inventoryItemId === batch.outputInventoryItemId &&
            movement.quantityDelta === batch.producedQuantity &&
            movement.unitOfMeasure === batch.unitOfMeasure,
        ) &&
        report.movements.some(
          (movement) =>
            movement.businessOriginType === "PRODUCTION" &&
            movement.businessOriginId === batch.id &&
            movement.type === "PRODUCTION_CONSUMPTION",
        ),
    )
  );
}

function validMovementOrigin(value: InventoryReportMovement) {
  if (value.type === "PURCHASE") return value.businessOriginType === "PURCHASE";
  if (
    value.type === "PRODUCTION_CONSUMPTION" ||
    value.type === "PRODUCTION_OUTPUT"
  )
    return value.businessOriginType === "PRODUCTION";
  if (value.type === "SALE") return value.businessOriginType === "SALE";
  if (value.type === "ADJUSTMENT")
    return value.businessOriginType === "ADJUSTMENT";
  if (value.type === "WASTE") return value.businessOriginType === "WASTE";
  return (
    value.businessOriginType === "ROLLBACK" && value.reversedMovementId !== null
  );
}

function categoryDetailMatches(
  expenses: readonly ExpenseReportEntry[],
  totals: readonly ExpenseCategoryTotal[],
) {
  const expected = new Map<string, string[]>();
  for (const expense of expenses) {
    const key = `${expense.expenseCategoryCode}\u0000${expense.expenseCategoryName}`;
    expected.set(key, [...(expected.get(key) ?? []), expense.amount]);
  }
  return (
    expected.size === totals.length &&
    totals.every(
      (total) =>
        sumMoney(
          expected.get(
            `${total.expenseCategoryCode}\u0000${total.expenseCategoryName}`,
          ) ?? [],
        ) === total.amount,
    )
  );
}

function within(timestampValue: string, query: DailySalesReportQuery) {
  const instant = Date.parse(timestampValue);
  return (
    instant >= Date.parse(query.periodStart) &&
    instant < Date.parse(query.periodEnd)
  );
}

function balance(value: InventoryReportBalance) {
  return Boolean(
    uuid(value.inventoryItemId) &&
    nonblank(value.inventoryItemName) &&
    nonblank(value.inventoryItemType) &&
    nonblank(value.unitOfMeasure) &&
    unsignedDecimal(value.minimumStockLevel) &&
    signedDecimal(value.currentBalance) &&
    typeof value.isBelowMinimum === "boolean",
  );
}

function alert(value: InventoryReportAlert) {
  return Boolean(
    uuid(value.id) &&
    uuid(value.inventoryItemId) &&
    nonblank(value.inventoryItemName) &&
    nonblank(value.unitOfMeasure) &&
    unsignedDecimal(value.threshold) &&
    signedDecimal(value.observedBalance) &&
    timestamp(value.openedAt),
  );
}

function movement(value: InventoryReportMovement) {
  return Boolean(
    uuid(value.id) &&
    uuid(value.inventoryItemId) &&
    nonblank(value.inventoryItemName) &&
    INVENTORY_MOVEMENT_TYPES.includes(value.type) &&
    nonzeroDecimal(value.quantityDelta) &&
    nonblank(value.unitOfMeasure) &&
    uuid(value.recordedById) &&
    timestamp(value.recordedAt) &&
    nonblank(value.businessOriginType) &&
    uuid(value.businessOriginId) &&
    optionalText(value.comments, 2_000) &&
    nullableUuid(value.reversedMovementId),
  );
}

function purchase(value: InventoryReportPurchase) {
  return Boolean(
    uuid(value.id) &&
    uuid(value.operatingExpenseId) &&
    nonblank(value.expenseCategoryCode) &&
    nonblank(value.expenseCategoryName) &&
    uuid(value.recordedById) &&
    optionalText(value.supplierName, 200) &&
    optionalText(value.referenceNumber, 200) &&
    optionalText(value.comments, 2_000) &&
    positiveMoney(value.totalAmount) &&
    timestamp(value.recordedAt) &&
    Array.isArray(value.lines) &&
    value.lines.length > 0 &&
    unique(value.lines, (line) => line.inventoryMovementId, purchaseLine) &&
    sumMoney(value.lines.map((line) => line.lineTotal)) === value.totalAmount,
  );
}

function purchaseLine(value: InventoryReportPurchaseLine) {
  return Boolean(
    uuid(value.inventoryItemId) &&
    nonblank(value.inventoryItemName) &&
    uuid(value.inventoryMovementId) &&
    positiveDecimal(value.quantity) &&
    nonblank(value.unitOfMeasure) &&
    positiveMoney(value.unitPrice) &&
    positiveMoney(value.lineTotal),
  );
}

function productionBatch(value: InventoryReportProductionBatch) {
  return Boolean(
    uuid(value.id) &&
    uuid(value.recipeVersionId) &&
    positiveInteger(value.recipeVersionNumber) &&
    nonblank(value.recipeName) &&
    uuid(value.outputInventoryItemId) &&
    nonblank(value.outputInventoryItemName) &&
    positiveDecimal(value.producedQuantity) &&
    nonblank(value.unitOfMeasure) &&
    uuid(value.completedById) &&
    timestamp(value.completedAt) &&
    optionalText(value.notes, 2_000),
  );
}

function correction(value: InventoryReportCorrection) {
  return Boolean(
    uuid(value.id) &&
    uuid(value.inventoryItemId) &&
    nonblank(value.inventoryItemName) &&
    uuid(value.inventoryMovementId) &&
    nonzeroDecimal(value.quantity) &&
    nonblank(value.unitOfMeasure) &&
    nonblank(value.reason) &&
    value.reason.length <= 2_000 &&
    uuid(value.recordedById) &&
    timestamp(value.recordedAt),
  );
}

function expense(value: ExpenseReportEntry) {
  return Boolean(
    uuid(value.id) &&
    positiveMoney(value.amount) &&
    nonblank(value.description) &&
    timestamp(value.incurredAt) &&
    timestamp(value.recordedAt) &&
    uuid(value.recordedById) &&
    optionalText(value.referenceNumber, 200) &&
    optionalText(value.comments, 2_000) &&
    nonblank(value.expenseCategoryCode) &&
    nonblank(value.expenseCategoryName) &&
    (value.originType === "MANUAL" || value.originType === "PURCHASE") &&
    (value.originType === "PURCHASE"
      ? uuid(value.originId)
      : value.originId === null),
  );
}

function matchesCorrection(
  entry: InventoryReportCorrection,
  movements: readonly InventoryReportMovement[],
  origin: string,
  negate: boolean,
) {
  return movements.some(
    (movement) =>
      movement.id === entry.inventoryMovementId &&
      movement.businessOriginType === origin &&
      movement.businessOriginId === entry.id &&
      movement.inventoryItemId === entry.inventoryItemId &&
      movement.quantityDelta ===
        (negate ? `-${entry.quantity}` : entry.quantity) &&
      movement.unitOfMeasure === entry.unitOfMeasure,
  );
}

function categoryTotals(value: readonly ExpenseCategoryTotal[]) {
  return unique(
    value,
    (entry) => `${entry.expenseCategoryCode}\u0000${entry.expenseCategoryName}`,
    (entry) =>
      nonblank(entry.expenseCategoryCode) &&
      nonblank(entry.expenseCategoryName) &&
      positiveMoney(entry.amount),
  );
}

function monthlyDays(value: readonly ExpenseDailyTotal[], month: string) {
  if (!Array.isArray(value)) return false;
  const expectedDays = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  return (
    value.length === expectedDays &&
    value.every(
      (entry, index) =>
        entry.date === `${month}-${String(index + 1).padStart(2, "0")}` &&
        money(entry.amount),
    )
  );
}

function expectedMonth(query: DailySalesReportQuery) {
  const [year, month] = query.date.split("-").map(Number);
  const first = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const nextDate = new Date(Date.UTC(year, month, 1));
  const next = `${String(nextDate.getUTCFullYear()).padStart(4, "0")}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const firstQuery = parseDailySalesReportQuery({ ...query, date: first });
  const nextQuery = parseDailySalesReportQuery({ ...query, date: next });
  return firstQuery && nextQuery
    ? { start: firstQuery.periodStart, end: nextQuery.periodStart }
    : null;
}

function unique<T>(
  value: readonly T[],
  key: (entry: T) => string,
  validate: (entry: T) => boolean,
) {
  if (!Array.isArray(value)) return false;
  const keys = new Set<string>();
  return value.every((entry) => {
    const entryKey = key(entry);
    if (!validate(entry) || keys.has(entryKey)) return false;
    keys.add(entryKey);
    return true;
  });
}

function money(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d{2}$/.test(value);
}
function positiveMoney(value: unknown): value is string {
  return money(value) && cents(value) > BigInt(0);
}
function sumMoney(values: readonly string[]) {
  const total = values.reduce((sum, value) => sum + cents(value), BigInt(0));
  const canonical = total.toString().padStart(3, "0");
  return `${canonical.slice(0, -2)}.${canonical.slice(-2)}`;
}
function cents(value: string) {
  return BigInt(value.replace(".", ""));
}
function signedDecimal(value: unknown): value is string {
  return typeof value === "string" && /^-?\d+\.\d{3}$/.test(value);
}
function unsignedDecimal(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d{3}$/.test(value);
}
function nonzeroDecimal(value: unknown): value is string {
  return signedDecimal(value) && Number(value) !== 0;
}
function positiveDecimal(value: unknown): value is string {
  return unsignedDecimal(value) && Number(value) > 0;
}
function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
function nullableUuid(value: unknown): value is string | null {
  return value === null || uuid(value);
}
function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function optionalText(value: unknown, maximum: number) {
  return (
    value === null || (typeof value === "string" && value.length <= maximum)
  );
}
function isUnauthorizedPersistenceError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (("code" in error && error.code === "42501") ||
      ("persistenceCode" in error && error.persistenceCode === "42501"))
  );
}
function failure(code: InventoryProductionExpenseReportError["code"]) {
  return err(
    Object.freeze({
      kind: "inventory-production-expense-report-error" as const,
      code,
    }),
  );
}
