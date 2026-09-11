import type { SupabaseClient } from "@supabase/supabase-js";

import {
  REPORTING_TIME_ZONE,
  type DailySalesReportQuery,
  type ExpenseCategoryTotal,
  type ExpenseDailyTotal,
  type ExpenseReportEntry,
  type InventoryProductionExpenseReport,
  type InventoryProductionExpenseReportReader,
  type InventoryReportAlert,
  type InventoryReportBalance,
  type InventoryReportCorrection,
  type InventoryReportMovement,
  type InventoryReportProductionBatch,
  type InventoryReportPurchase,
  type InventoryReportPurchaseLine,
} from "../../application";
import { DailySalesReportReadError } from "./supabase-daily-sales-report-reader";

export class SupabaseInventoryProductionExpenseReportReader implements InventoryProductionExpenseReportReader {
  constructor(private readonly client: SupabaseClient) {}

  async read(
    query: DailySalesReportQuery,
  ): Promise<InventoryProductionExpenseReport | null> {
    try {
      const { data, error } = await this.client.rpc(
        "read_inventory_production_expense_report",
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
      throw new DailySalesReportReadError(errorCode(error));
    }
  }
}

export function mapInventoryProductionExpenseReportRow(
  value: unknown,
  query: DailySalesReportQuery,
): InventoryProductionExpenseReport | null {
  try {
    return mapReport(value, query);
  } catch {
    return null;
  }
}

function mapReport(
  value: unknown,
  query: DailySalesReportQuery,
): InventoryProductionExpenseReport {
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
  const monthStart = timestamp(value.month_start);
  const monthEnd = timestamp(value.month_end);
  const inventoryBalances = mapArray(value.inventory_balances, mapBalance);
  const activeAlerts = mapArray(value.active_alerts, mapAlert);
  const movements = mapArray(value.movements, mapMovement);
  const purchases = mapArray(value.purchases, mapPurchase);
  const productionBatches = mapArray(
    value.production_batches,
    mapProductionBatch,
  );
  const adjustments = mapArray(value.adjustments, mapCorrection);
  const wasteRecords = mapArray(value.waste_records, mapCorrection);
  const expenses = mapArray(value.expenses, mapExpense);
  const dailyExpenseTotal = money(value.daily_expense_total);
  const monthlyExpenseTotal = money(value.monthly_expense_total);
  const dailyExpensesByCategory = mapArray(
    value.daily_expenses_by_category,
    mapCategoryTotal,
  );
  const monthlyExpensesByCategory = mapArray(
    value.monthly_expenses_by_category,
    mapCategoryTotal,
  );
  const monthlyExpensesByDay = mapArray(
    value.monthly_expenses_by_day,
    mapDailyTotal,
  );
  if (
    monthStart === null ||
    monthEnd === null ||
    inventoryBalances === null ||
    activeAlerts === null ||
    movements === null ||
    purchases === null ||
    productionBatches === null ||
    adjustments === null ||
    wasteRecords === null ||
    expenses === null ||
    dailyExpenseTotal === null ||
    monthlyExpenseTotal === null ||
    dailyExpensesByCategory === null ||
    monthlyExpensesByCategory === null ||
    monthlyExpensesByDay === null
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
    monthStart,
    monthEnd,
    inventoryBalances,
    activeAlerts,
    movements,
    purchases,
    productionBatches,
    adjustments,
    wasteRecords,
    expenses,
    dailyExpenseTotal,
    monthlyExpenseTotal,
    dailyExpensesByCategory,
    monthlyExpensesByCategory,
    monthlyExpensesByDay,
  });
}

function mapBalance(value: unknown): InventoryReportBalance | null {
  if (
    !record(value) ||
    !uuid(value.inventory_item_id) ||
    !nonblank(value.inventory_item_name) ||
    !nonblank(value.inventory_item_type) ||
    !nonblank(value.unit_of_measure) ||
    typeof value.is_below_minimum !== "boolean"
  )
    return null;
  const minimumStockLevel = decimal(value.minimum_stock_level, false);
  const currentBalance = decimal(value.current_balance, true);
  return minimumStockLevel && currentBalance
    ? Object.freeze({
        inventoryItemId: value.inventory_item_id,
        inventoryItemName: value.inventory_item_name,
        inventoryItemType: value.inventory_item_type,
        unitOfMeasure: value.unit_of_measure,
        minimumStockLevel,
        currentBalance,
        isBelowMinimum: value.is_below_minimum,
      })
    : null;
}

function mapAlert(value: unknown): InventoryReportAlert | null {
  if (
    !record(value) ||
    !uuid(value.id) ||
    !uuid(value.inventory_item_id) ||
    !nonblank(value.inventory_item_name) ||
    !nonblank(value.unit_of_measure)
  )
    return null;
  const threshold = decimal(value.threshold, false);
  const observedBalance = decimal(value.observed_balance, true);
  const openedAt = timestamp(value.opened_at);
  return threshold && observedBalance && openedAt
    ? Object.freeze({
        id: value.id,
        inventoryItemId: value.inventory_item_id,
        inventoryItemName: value.inventory_item_name,
        unitOfMeasure: value.unit_of_measure,
        threshold,
        observedBalance,
        openedAt,
      })
    : null;
}

function mapMovement(value: unknown): InventoryReportMovement | null {
  if (
    !record(value) ||
    !uuid(value.id) ||
    !uuid(value.inventory_item_id) ||
    !nonblank(value.inventory_item_name) ||
    !movementType(value.type) ||
    !nonblank(value.unit_of_measure) ||
    !uuid(value.recorded_by_id) ||
    !nonblank(value.business_origin_type) ||
    !uuid(value.business_origin_id) ||
    !optionalText(value.comments) ||
    !nullableUuid(value.reversed_movement_id)
  )
    return null;
  const quantityDelta = decimal(value.quantity_delta, true);
  const recordedAt = timestamp(value.recorded_at);
  return quantityDelta && recordedAt
    ? Object.freeze({
        id: value.id,
        inventoryItemId: value.inventory_item_id,
        inventoryItemName: value.inventory_item_name,
        type: value.type,
        quantityDelta,
        unitOfMeasure: value.unit_of_measure,
        recordedById: value.recorded_by_id,
        recordedAt,
        businessOriginType: value.business_origin_type,
        businessOriginId: value.business_origin_id,
        comments: value.comments as string | null,
        reversedMovementId: value.reversed_movement_id as string | null,
      })
    : null;
}

function mapPurchase(value: unknown): InventoryReportPurchase | null {
  if (
    !record(value) ||
    !uuid(value.id) ||
    !uuid(value.operating_expense_id) ||
    !nonblank(value.expense_category_code) ||
    !nonblank(value.expense_category_name) ||
    !uuid(value.recorded_by_id) ||
    !optionalText(value.supplier_name) ||
    !optionalText(value.reference_number) ||
    !optionalText(value.comments)
  )
    return null;
  const totalAmount = money(value.total_amount);
  const recordedAt = timestamp(value.recorded_at);
  const lines = mapArray(value.lines, mapPurchaseLine);
  return totalAmount && recordedAt && lines
    ? Object.freeze({
        id: value.id,
        operatingExpenseId: value.operating_expense_id,
        expenseCategoryCode: value.expense_category_code,
        expenseCategoryName: value.expense_category_name,
        recordedById: value.recorded_by_id,
        supplierName: value.supplier_name as string | null,
        referenceNumber: value.reference_number as string | null,
        comments: value.comments as string | null,
        totalAmount,
        recordedAt,
        lines,
      })
    : null;
}

function mapPurchaseLine(value: unknown): InventoryReportPurchaseLine | null {
  if (
    !record(value) ||
    !uuid(value.inventory_item_id) ||
    !nonblank(value.inventory_item_name) ||
    !uuid(value.inventory_movement_id) ||
    !nonblank(value.unit_of_measure)
  )
    return null;
  const quantity = decimal(value.quantity, false);
  const unitPrice = money(value.unit_price);
  const lineTotal = money(value.line_total);
  return quantity && unitPrice && lineTotal
    ? Object.freeze({
        inventoryItemId: value.inventory_item_id,
        inventoryItemName: value.inventory_item_name,
        inventoryMovementId: value.inventory_movement_id,
        quantity,
        unitOfMeasure: value.unit_of_measure,
        unitPrice,
        lineTotal,
      })
    : null;
}

function mapProductionBatch(
  value: unknown,
): InventoryReportProductionBatch | null {
  if (
    !record(value) ||
    !uuid(value.id) ||
    !uuid(value.recipe_version_id) ||
    !nonblank(value.recipe_name) ||
    !uuid(value.output_inventory_item_id) ||
    !nonblank(value.output_inventory_item_name) ||
    !nonblank(value.unit_of_measure) ||
    !uuid(value.completed_by_id) ||
    !optionalText(value.notes)
  )
    return null;
  const recipeVersionNumber = positiveInteger(value.recipe_version_number);
  const producedQuantity = decimal(value.produced_quantity, false);
  const completedAt = timestamp(value.completed_at);
  return recipeVersionNumber && producedQuantity && completedAt
    ? Object.freeze({
        id: value.id,
        recipeVersionId: value.recipe_version_id,
        recipeVersionNumber,
        recipeName: value.recipe_name,
        outputInventoryItemId: value.output_inventory_item_id,
        outputInventoryItemName: value.output_inventory_item_name,
        producedQuantity,
        unitOfMeasure: value.unit_of_measure,
        completedById: value.completed_by_id,
        completedAt,
        notes: value.notes as string | null,
      })
    : null;
}

function mapCorrection(value: unknown): InventoryReportCorrection | null {
  if (
    !record(value) ||
    !uuid(value.id) ||
    !uuid(value.inventory_item_id) ||
    !nonblank(value.inventory_item_name) ||
    !uuid(value.inventory_movement_id) ||
    !nonblank(value.unit_of_measure) ||
    !nonblank(value.reason) ||
    !uuid(value.recorded_by_id)
  )
    return null;
  const quantity = decimal(value.quantity, true);
  const recordedAt = timestamp(value.recorded_at);
  return quantity && recordedAt
    ? Object.freeze({
        id: value.id,
        inventoryItemId: value.inventory_item_id,
        inventoryItemName: value.inventory_item_name,
        inventoryMovementId: value.inventory_movement_id,
        quantity,
        unitOfMeasure: value.unit_of_measure,
        reason: value.reason,
        recordedById: value.recorded_by_id,
        recordedAt,
      })
    : null;
}

function mapExpense(value: unknown): ExpenseReportEntry | null {
  if (
    !record(value) ||
    !uuid(value.id) ||
    !nonblank(value.description) ||
    !uuid(value.recorded_by_id) ||
    !optionalText(value.reference_number) ||
    !optionalText(value.comments) ||
    !nonblank(value.expense_category_code) ||
    !nonblank(value.expense_category_name) ||
    (value.origin_type !== "MANUAL" && value.origin_type !== "PURCHASE") ||
    !nullableUuid(value.origin_id)
  )
    return null;
  const amount = money(value.amount);
  const incurredAt = timestamp(value.incurred_at);
  const recordedAt = timestamp(value.recorded_at);
  return amount && incurredAt && recordedAt
    ? Object.freeze({
        id: value.id,
        amount,
        description: value.description,
        incurredAt,
        recordedAt,
        recordedById: value.recorded_by_id,
        referenceNumber: value.reference_number as string | null,
        comments: value.comments as string | null,
        expenseCategoryCode: value.expense_category_code,
        expenseCategoryName: value.expense_category_name,
        originType: value.origin_type,
        originId: value.origin_id as string | null,
      })
    : null;
}

function mapCategoryTotal(value: unknown): ExpenseCategoryTotal | null {
  if (
    !record(value) ||
    !nonblank(value.expense_category_code) ||
    !nonblank(value.expense_category_name)
  )
    return null;
  const amount = money(value.amount);
  return amount
    ? Object.freeze({
        expenseCategoryCode: value.expense_category_code,
        expenseCategoryName: value.expense_category_name,
        amount,
      })
    : null;
}

function mapDailyTotal(value: unknown): ExpenseDailyTotal | null {
  if (!record(value) || !/^\d{4}-\d{2}-\d{2}$/.test(String(value.date)))
    return null;
  const amount = money(value.amount);
  return amount ? Object.freeze({ date: value.date as string, amount }) : null;
}

function mapArray<T>(
  value: unknown,
  mapper: (entry: unknown) => T | null,
): readonly T[] | null {
  if (!Array.isArray(value)) return null;
  const result = value.map(mapper);
  return result.some((entry) => entry === null)
    ? null
    : Object.freeze(result as T[]);
}

function money(value: unknown): string | null {
  return normalizeDecimal(value, 2, false);
}
function decimal(value: unknown, signed: boolean): string | null {
  return normalizeDecimal(value, 3, signed);
}
function normalizeDecimal(value: unknown, scale: number, signed: boolean) {
  const expression = signed ? /^(-?)(\d+)(?:\.(\d+))?$/ : /^(\d+)(?:\.(\d+))?$/;
  const match =
    (typeof value === "string" || typeof value === "number") &&
    expression.exec(String(value));
  if (!match) return null;
  const sign = signed ? match[1] : "";
  const whole = (signed ? match[2] : match[1]).replace(/^0+(?=\d)/, "");
  const fraction = (signed ? match[3] : match[2]) ?? "";
  if (fraction.length > scale) return null;
  return `${sign}${whole}.${fraction.padEnd(scale, "0")}`;
}
function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
function movementType(
  value: unknown,
): value is InventoryReportMovement["type"] {
  return (
    value === "PURCHASE" ||
    value === "PRODUCTION_CONSUMPTION" ||
    value === "PRODUCTION_OUTPUT" ||
    value === "SALE" ||
    value === "ADJUSTMENT" ||
    value === "WASTE" ||
    value === "ROLLBACK"
  );
}
function positiveInteger(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
function optionalText(value: unknown) {
  return value === null || typeof value === "string";
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
function errorCode(error: unknown) {
  return record(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}
