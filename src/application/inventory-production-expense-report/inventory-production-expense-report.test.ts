import { describe, expect, it, vi } from "vitest";

import { REPORTING_TIME_ZONE } from "../daily-sales-report";
import {
  InventoryProductionExpenseReportService,
  type InventoryProductionExpenseReport,
  type InventoryProductionExpenseReportReader,
} from "./inventory-production-expense-report";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const itemId = "40000000-0000-4000-8000-000000000001";
const purchaseId = "50000000-0000-4000-8000-000000000001";
const purchaseMovementId = "60000000-0000-4000-8000-000000000001";
const productionId = "50000000-0000-4000-8000-000000000002";
const productionMovementId = "60000000-0000-4000-8000-000000000002";
const productionConsumptionMovementId = "60000000-0000-4000-8000-000000000005";
const adjustmentId = "50000000-0000-4000-8000-000000000003";
const adjustmentMovementId = "60000000-0000-4000-8000-000000000003";
const wasteId = "50000000-0000-4000-8000-000000000004";
const wasteMovementId = "60000000-0000-4000-8000-000000000004";

function movement(
  id: string,
  type: InventoryProductionExpenseReport["movements"][number]["type"],
  quantityDelta: string,
  businessOriginType: string,
  businessOriginId: string,
) {
  return Object.freeze({
    id,
    inventoryItemId: itemId,
    inventoryItemName: "Maíz",
    type,
    quantityDelta,
    unitOfMeasure: "kg",
    recordedById: actorId,
    recordedAt: "2026-09-06T10:00:00.000Z",
    businessOriginType,
    businessOriginId,
    comments: null,
    reversedMovementId: null,
  });
}

function report(): InventoryProductionExpenseReport {
  return Object.freeze({
    restaurant: Object.freeze({ id: restaurantId, name: "Carnales" }),
    date: "2026-09-06",
    timeZone: REPORTING_TIME_ZONE,
    periodStart: "2026-09-06T05:00:00.000Z",
    periodEnd: "2026-09-07T05:00:00.000Z",
    monthStart: "2026-09-01T05:00:00.000Z",
    monthEnd: "2026-10-01T05:00:00.000Z",
    inventoryBalances: Object.freeze([
      Object.freeze({
        inventoryItemId: itemId,
        inventoryItemName: "Maíz",
        inventoryItemType: "RAW_INGREDIENT",
        unitOfMeasure: "kg",
        minimumStockLevel: "5.000",
        currentBalance: "4.000",
        isBelowMinimum: true,
      }),
    ]),
    activeAlerts: Object.freeze([
      Object.freeze({
        id: "70000000-0000-4000-8000-000000000001",
        inventoryItemId: itemId,
        inventoryItemName: "Maíz",
        unitOfMeasure: "kg",
        threshold: "5.000",
        observedBalance: "4.000",
        openedAt: "2026-09-06T10:00:00.000Z",
      }),
    ]),
    movements: Object.freeze([
      movement(purchaseMovementId, "PURCHASE", "2.000", "PURCHASE", purchaseId),
      movement(
        productionMovementId,
        "PRODUCTION_OUTPUT",
        "3.000",
        "PRODUCTION",
        productionId,
      ),
      movement(
        productionConsumptionMovementId,
        "PRODUCTION_CONSUMPTION",
        "-1.000",
        "PRODUCTION",
        productionId,
      ),
      movement(
        adjustmentMovementId,
        "ADJUSTMENT",
        "1.000",
        "ADJUSTMENT",
        adjustmentId,
      ),
      movement(wasteMovementId, "WASTE", "-2.000", "WASTE", wasteId),
    ]),
    purchases: Object.freeze([
      Object.freeze({
        id: purchaseId,
        operatingExpenseId: "71000000-0000-4000-8000-000000000001",
        expenseCategoryCode: "SUPPLIES",
        expenseCategoryName: "Insumos",
        recordedById: actorId,
        supplierName: "Proveedor",
        referenceNumber: null,
        comments: null,
        totalAmount: "10.00",
        recordedAt: "2026-09-06T10:00:00.000Z",
        lines: Object.freeze([
          Object.freeze({
            inventoryItemId: itemId,
            inventoryItemName: "Maíz",
            inventoryMovementId: purchaseMovementId,
            quantity: "2.000",
            unitOfMeasure: "kg",
            unitPrice: "5.00",
            lineTotal: "10.00",
          }),
        ]),
      }),
    ]),
    productionBatches: Object.freeze([
      Object.freeze({
        id: productionId,
        recipeVersionId: "72000000-0000-4000-8000-000000000001",
        recipeVersionNumber: 1,
        recipeName: "Masa",
        outputInventoryItemId: itemId,
        outputInventoryItemName: "Maíz",
        producedQuantity: "3.000",
        unitOfMeasure: "kg",
        completedById: actorId,
        completedAt: "2026-09-06T10:00:00.000Z",
        notes: null,
      }),
    ]),
    adjustments: Object.freeze([
      Object.freeze({
        id: adjustmentId,
        inventoryItemId: itemId,
        inventoryItemName: "Maíz",
        inventoryMovementId: adjustmentMovementId,
        quantity: "1.000",
        unitOfMeasure: "kg",
        reason: "Conteo físico",
        recordedById: actorId,
        recordedAt: "2026-09-06T10:00:00.000Z",
      }),
    ]),
    wasteRecords: Object.freeze([
      Object.freeze({
        id: wasteId,
        inventoryItemId: itemId,
        inventoryItemName: "Maíz",
        inventoryMovementId: wasteMovementId,
        quantity: "2.000",
        unitOfMeasure: "kg",
        reason: "Derrame",
        recordedById: actorId,
        recordedAt: "2026-09-06T10:00:00.000Z",
      }),
    ]),
    expenses: Object.freeze([
      expense(
        "71000000-0000-4000-8000-000000000001",
        "10.00",
        "PURCHASE",
        purchaseId,
      ),
      expense("71000000-0000-4000-8000-000000000002", "5.00", "MANUAL", null),
    ]),
    dailyExpenseTotal: "15.00",
    monthlyExpenseTotal: "15.00",
    dailyExpensesByCategory: Object.freeze([
      Object.freeze({
        expenseCategoryCode: "SUPPLIES",
        expenseCategoryName: "Insumos",
        amount: "15.00",
      }),
    ]),
    monthlyExpensesByCategory: Object.freeze([
      Object.freeze({
        expenseCategoryCode: "SUPPLIES",
        expenseCategoryName: "Insumos",
        amount: "15.00",
      }),
    ]),
    monthlyExpensesByDay: Object.freeze(
      Array.from({ length: 30 }, (_, index) =>
        Object.freeze({
          date: `2026-09-${String(index + 1).padStart(2, "0")}`,
          amount: index === 5 ? "15.00" : "0.00",
        }),
      ),
    ),
  });
}

function expense(
  id: string,
  amount: string,
  originType: "MANUAL" | "PURCHASE",
  originId: string | null,
) {
  return Object.freeze({
    id,
    amount,
    description: originType === "PURCHASE" ? "Inventory purchase" : "Gas",
    incurredAt: "2026-09-06T10:00:00.000Z",
    recordedAt: "2026-09-06T10:00:00.000Z",
    recordedById: actorId,
    referenceNumber: null,
    comments: null,
    expenseCategoryCode: "SUPPLIES",
    expenseCategoryName: "Insumos",
    originType,
    originId,
  });
}

function reader(value: InventoryProductionExpenseReport | null = report()) {
  return {
    read: vi.fn().mockResolvedValue(value),
  } satisfies InventoryProductionExpenseReportReader;
}

const input = {
  actorId,
  restaurantId,
  date: "2026-09-06",
  timeZone: REPORTING_TIME_ZONE,
};

describe("InventoryProductionExpenseReportService", () => {
  it("uses Guayaquil day/month boundaries and accepts consistent persisted details", async () => {
    const persistence = reader();
    await expect(
      new InventoryProductionExpenseReportService(persistence).read(input),
    ).resolves.toEqual({ ok: true, value: report() });
    expect(persistence.read).toHaveBeenCalledWith(
      expect.objectContaining({
        periodStart: "2026-09-06T05:00:00.000Z",
        periodEnd: "2026-09-07T05:00:00.000Z",
      }),
    );
  });

  it("rejects malformed input before persistence", async () => {
    const persistence = reader();
    await expect(
      new InventoryProductionExpenseReportService(persistence).read({
        ...input,
        timeZone: "UTC",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(persistence.read).not.toHaveBeenCalled();
  });

  it("fails closed when immutable detail and totals disagree", async () => {
    await expect(
      new InventoryProductionExpenseReportService(
        reader({ ...report(), dailyExpenseTotal: "14.00" }),
      ).read(input),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
  });

  it("fails closed when a correction is detached from its immutable movement", async () => {
    const invalid = report();
    await expect(
      new InventoryProductionExpenseReportService(
        reader({
          ...invalid,
          wasteRecords: [
            {
              ...invalid.wasteRecords[0],
              inventoryMovementId: purchaseMovementId,
            },
          ],
        }),
      ).read(input),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
  });

  it("maps persistence authorization denial without exposing details", async () => {
    const persistence = reader();
    persistence.read.mockRejectedValue({ persistenceCode: "42501" });
    await expect(
      new InventoryProductionExpenseReportService(persistence).read(input),
    ).resolves.toEqual({
      ok: false,
      error: {
        kind: "inventory-production-expense-report-error",
        code: "UNAUTHORIZED",
      },
    });
  });
});
