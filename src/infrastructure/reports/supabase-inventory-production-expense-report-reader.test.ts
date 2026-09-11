import { describe, expect, it, vi } from "vitest";

import {
  REPORTING_TIME_ZONE,
  type DailySalesReportQuery,
} from "../../application";
import { SupabaseInventoryProductionExpenseReportReader } from "./supabase-inventory-production-expense-report-reader";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const itemId = "40000000-0000-4000-8000-000000000001";
const query: DailySalesReportQuery = {
  actorId,
  restaurantId,
  date: "2026-09-06",
  timeZone: REPORTING_TIME_ZONE,
  periodStart: "2026-09-06T05:00:00.000Z",
  periodEnd: "2026-09-07T05:00:00.000Z",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    restaurant_id: restaurantId,
    restaurant_name: "Carnales",
    report_date_result: "2026-09-06",
    reporting_timezone_result: REPORTING_TIME_ZONE,
    period_start: "2026-09-06T05:00:00+00:00",
    period_end: "2026-09-07T05:00:00+00:00",
    month_start: "2026-09-01T05:00:00+00:00",
    month_end: "2026-10-01T05:00:00+00:00",
    inventory_balances: [
      {
        inventory_item_id: itemId,
        inventory_item_name: "Maíz",
        inventory_item_type: "RAW_INGREDIENT",
        unit_of_measure: "kg",
        minimum_stock_level: "5",
        current_balance: 4,
        is_below_minimum: true,
      },
    ],
    active_alerts: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        inventory_item_id: itemId,
        inventory_item_name: "Maíz",
        unit_of_measure: "kg",
        threshold: "5.0",
        observed_balance: "4.000",
        opened_at: "2026-09-06T10:00:00+00:00",
      },
    ],
    movements: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        inventory_item_id: itemId,
        inventory_item_name: "Maíz",
        type: "ADJUSTMENT",
        quantity_delta: "1",
        unit_of_measure: "kg",
        recorded_by_id: actorId,
        recorded_at: "2026-09-06T10:00:00+00:00",
        business_origin_type: "ADJUSTMENT",
        business_origin_id: "70000000-0000-4000-8000-000000000001",
        comments: null,
        reversed_movement_id: null,
      },
    ],
    purchases: [],
    production_batches: [],
    adjustments: [
      {
        id: "70000000-0000-4000-8000-000000000001",
        inventory_item_id: itemId,
        inventory_item_name: "Maíz",
        inventory_movement_id: "60000000-0000-4000-8000-000000000001",
        quantity: "1",
        unit_of_measure: "kg",
        reason: "Conteo físico",
        recorded_by_id: actorId,
        recorded_at: "2026-09-06T10:00:00+00:00",
      },
    ],
    waste_records: [],
    expenses: [
      {
        id: "80000000-0000-4000-8000-000000000001",
        amount: "7.5",
        description: "Gas",
        incurred_at: "2026-09-06T11:00:00+00:00",
        recorded_at: "2026-09-06T11:01:00+00:00",
        recorded_by_id: actorId,
        reference_number: null,
        comments: null,
        expense_category_code: "UTILITIES",
        expense_category_name: "Servicios",
        origin_type: "MANUAL",
        origin_id: null,
      },
    ],
    daily_expense_total: "7.5",
    monthly_expense_total: 7.5,
    daily_expenses_by_category: [
      {
        expense_category_code: "UTILITIES",
        expense_category_name: "Servicios",
        amount: "7.50",
      },
    ],
    monthly_expenses_by_category: [
      {
        expense_category_code: "UTILITIES",
        expense_category_name: "Servicios",
        amount: "7.50",
      },
    ],
    monthly_expenses_by_day: Array.from({ length: 30 }, (_, index) => ({
      date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      amount: index === 5 ? "7.5" : 0,
    })),
    ...overrides,
  };
}

function clientWith(data: unknown[], error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc } as never, rpc };
}

describe("SupabaseInventoryProductionExpenseReportReader", () => {
  it("calls the protected aggregate and maps persisted inventory and expense values", async () => {
    const { client, rpc } = clientWith([row()]);
    const result = await new SupabaseInventoryProductionExpenseReportReader(
      client,
    ).read(query);
    expect(rpc).toHaveBeenCalledWith(
      "read_inventory_production_expense_report",
      {
        actor_user_id: actorId,
        target_restaurant_id: restaurantId,
        report_date: "2026-09-06",
        reporting_timezone: REPORTING_TIME_ZONE,
      },
    );
    expect(result).toMatchObject({
      inventoryBalances: [
        { minimumStockLevel: "5.000", currentBalance: "4.000" },
      ],
      activeAlerts: [{ observedBalance: "4.000" }],
      movements: [{ quantityDelta: "1.000" }],
      adjustments: [{ quantity: "1.000" }],
      expenses: [{ amount: "7.50", expenseCategoryName: "Servicios" }],
      dailyExpenseTotal: "7.50",
      monthlyExpenseTotal: "7.50",
    });
    expect(result?.monthlyExpensesByDay).toHaveLength(30);
  });

  it.each([
    [
      "inventory_balances",
      [{ ...row().inventory_balances[0], inventory_item_id: "bad" }],
    ],
    ["movements", [{ ...row().movements[0], type: "FORECAST" }]],
    ["production_batches", false],
    ["expenses", [{ ...row().expenses[0], incurred_at: "bad" }]],
    ["monthly_expenses_by_day", [{ date: "bad", amount: "0" }]],
  ])("fails closed for malformed %s", async (field, value) => {
    const { client } = clientWith([row({ [field]: value })]);
    await expect(
      new SupabaseInventoryProductionExpenseReportReader(client).read(query),
    ).rejects.toThrow("Daily sales report could not be read.");
  });

  it("preserves authorization error codes from persistence", async () => {
    const { client } = clientWith([], { code: "42501" });
    await expect(
      new SupabaseInventoryProductionExpenseReportReader(client).read(query),
    ).rejects.toMatchObject({ persistenceCode: "42501" });
  });
});
