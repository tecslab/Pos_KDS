import { describe, expect, it, vi } from "vitest";

import { ok } from "../../domain";
import type { DailySalesReport } from "../daily-sales-report";
import type { InventoryProductionExpenseReport } from "../inventory-production-expense-report";
import type { OperationalPerformanceReport } from "../operational-performance-report";
import type { PaymentReport } from "../payment-report";
import {
  buildReportExportDocument,
  ReportExportService,
  type ReportExportInput,
} from "./report-export";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const identity = {
  restaurant: { id: restaurantId, name: "Carnales Centro" },
  date: "2026-09-10",
  timeZone: "America/Guayaquil",
  periodStart: "2026-09-10T05:00:00.000Z",
  periodEnd: "2026-09-11T05:00:00.000Z",
} as const;

const daily = {
  ...identity,
  totalRevenue: "125.50",
  ordersCreated: 7,
  ordersCompleted: 5,
  averageTicket: "25.10",
  hourlyRevenue: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    amount: hour === 12 ? "125.50" : "0.00",
  })),
} as DailySalesReport;

const operational = {
  ...identity,
  productSales: [
    {
      productId: "20000000-0000-4000-8000-000000000001",
      productName: "Taco",
      quantitySold: 2,
      revenue: "12.00",
    },
  ],
  categorySales: [
    {
      categoryId: null,
      categoryName: "Unattributed historical category",
      quantitySold: 2,
      revenue: "12.00",
    },
  ],
  averagePreparationMinutes: "10.00",
  longestPreparationMinutes: "18.00",
  ordersCurrentlyInPreparation: 1,
  peakPreparationPeriods: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orders: 0,
  })),
  averageReadyToOnTheWayMinutes: "2.00",
  averageOnTheWayToDeliveredMinutes: "7.00",
  deliveredOrders: 4,
  ordersWaitingForDelivery: 1,
} as OperationalPerformanceReport;

const payments = {
  ...identity,
  totalRevenue: "125.50",
  totalOutstanding: "8.00",
  revenueByMethod: [
    {
      paymentMethodCode: "CASH",
      paymentMethodName: "Efectivo histórico",
      paymentCount: 3,
      amount: "125.50",
    },
  ],
  outstandingBalances: [
    {
      orderId: "40000000-0000-4000-8000-000000000001",
      orderNumber: "ORD-001",
      basketId: "50000000-0000-4000-8000-000000000001",
      basketTotal: "20.00",
      paidAmount: "12.00",
      outstandingBalance: "8.00",
    },
  ],
  partialPayments: [
    {
      orderId: "40000000-0000-4000-8000-000000000001",
      orderNumber: "ORD-001",
      basketId: "50000000-0000-4000-8000-000000000001",
      basketTotal: "20.00",
      paidAmount: "12.00",
      outstandingBalance: "8.00",
    },
  ],
  paymentHistory: [
    {
      id: "60000000-0000-4000-8000-000000000001",
      orderId: "40000000-0000-4000-8000-000000000001",
      orderNumber: "ORD-001",
      basketId: "50000000-0000-4000-8000-000000000001",
      amount: "12.00",
      paymentMethodCode: "CASH",
      paymentMethodName: "Efectivo histórico",
      recordedById: actorId,
      recordedAt: "2026-09-10T15:00:00.000Z",
      referenceNumber: "REF-EXPORT",
      comments: "Pago del reporte",
      overageAuthorizedById: null,
      overageAuthorizedAt: null,
      overageReason: null,
    },
  ],
} as PaymentReport;

const inventory = {
  ...identity,
  monthStart: "2026-09-01T05:00:00.000Z",
  monthEnd: "2026-10-01T05:00:00.000Z",
  inventoryBalances: [
    {
      inventoryItemId: "70000000-0000-4000-8000-000000000001",
      inventoryItemName: "Maíz histórico",
      inventoryItemType: "RAW_INGREDIENT",
      unitOfMeasure: "kg",
      minimumStockLevel: "5.000",
      currentBalance: "4.000",
      isBelowMinimum: true,
    },
  ],
  activeAlerts: [
    {
      id: "71000000-0000-4000-8000-000000000001",
      inventoryItemId: "70000000-0000-4000-8000-000000000001",
      inventoryItemName: "Maíz histórico",
      unitOfMeasure: "kg",
      threshold: "5.000",
      observedBalance: "4.000",
      openedAt: "2026-09-10T12:00:00.000Z",
    },
  ],
  movements: [
    {
      id: "72000000-0000-4000-8000-000000000001",
      inventoryItemId: "70000000-0000-4000-8000-000000000001",
      inventoryItemName: "Maíz histórico",
      type: "PRODUCTION_CONSUMPTION",
      quantityDelta: "-1.250",
      unitOfMeasure: "kg",
      recordedById: actorId,
      recordedAt: "2026-09-10T13:00:00.000Z",
      businessOriginType: "PRODUCTION",
      businessOriginId: "73000000-0000-4000-8000-000000000001",
      comments: "Consumo exportado",
      reversedMovementId: null,
    },
  ],
  purchases: [
    {
      id: "74000000-0000-4000-8000-000000000001",
      operatingExpenseId: "75000000-0000-4000-8000-000000000001",
      expenseCategoryCode: "INGREDIENTS",
      expenseCategoryName: "Ingredientes históricos",
      recordedById: actorId,
      supplierName: "Proveedor histórico",
      referenceNumber: "COMPRA-1",
      comments: "Compra exportada",
      totalAmount: "9.25",
      recordedAt: "2026-09-10T14:00:00.000Z",
      lines: [
        {
          inventoryItemId: "70000000-0000-4000-8000-000000000001",
          inventoryItemName: "Maíz histórico",
          inventoryMovementId: "76000000-0000-4000-8000-000000000001",
          quantity: "2.000",
          unitOfMeasure: "kg",
          unitPrice: "4.625",
          lineTotal: "9.25",
        },
      ],
    },
  ],
  productionBatches: [
    {
      id: "73000000-0000-4000-8000-000000000001",
      recipeVersionId: "77000000-0000-4000-8000-000000000001",
      recipeVersionNumber: 2,
      recipeName: "Masa histórica",
      outputInventoryItemId: "78000000-0000-4000-8000-000000000001",
      outputInventoryItemName: "Masa producida",
      producedQuantity: "10.000",
      unitOfMeasure: "kg",
      completedById: actorId,
      completedAt: "2026-09-10T13:00:00.000Z",
      notes: "Lote exportado",
    },
  ],
  adjustments: [
    {
      id: "79000000-0000-4000-8000-000000000001",
      inventoryItemId: "70000000-0000-4000-8000-000000000001",
      inventoryItemName: "Maíz histórico",
      inventoryMovementId: "79000000-0000-4000-8000-000000000002",
      quantity: "0.500",
      unitOfMeasure: "kg",
      reason: "Conteo físico exportado",
      recordedById: actorId,
      recordedAt: "2026-09-10T16:00:00.000Z",
    },
  ],
  wasteRecords: [
    {
      id: "80000000-0000-4000-8000-000000000001",
      inventoryItemId: "70000000-0000-4000-8000-000000000001",
      inventoryItemName: "Maíz histórico",
      inventoryMovementId: "80000000-0000-4000-8000-000000000002",
      quantity: "0.250",
      unitOfMeasure: "kg",
      reason: "Merma exportada",
      recordedById: actorId,
      recordedAt: "2026-09-10T17:00:00.000Z",
    },
  ],
  expenses: [
    {
      id: "75000000-0000-4000-8000-000000000001",
      amount: "9.25",
      description: "Compra histórica",
      incurredAt: "2026-09-10T14:00:00.000Z",
      recordedAt: "2026-09-10T14:00:00.000Z",
      recordedById: actorId,
      referenceNumber: "COMPRA-1",
      comments: "Gasto exportado",
      expenseCategoryCode: "INGREDIENTS",
      expenseCategoryName: "Ingredientes históricos",
      originType: "PURCHASE",
      originId: "74000000-0000-4000-8000-000000000001",
    },
  ],
  dailyExpenseTotal: "9.25",
  monthlyExpenseTotal: "80.00",
  dailyExpensesByCategory: [
    {
      expenseCategoryCode: "INGREDIENTS",
      expenseCategoryName: "Ingredientes históricos",
      amount: "9.25",
    },
  ],
  monthlyExpensesByCategory: [
    {
      expenseCategoryCode: "INGREDIENTS",
      expenseCategoryName: "Ingredientes históricos",
      amount: "80.00",
    },
  ],
  monthlyExpensesByDay: [{ date: "2026-09-10", amount: "9.25" }],
} as InventoryProductionExpenseReport;

const validInput: ReportExportInput = {
  actorId,
  restaurantId,
  date: identity.date,
  timeZone: identity.timeZone,
  format: "pdf",
};

function setup(overrides?: { operational?: OperationalPerformanceReport }) {
  const sequence: string[] = [];
  const reads = [
    daily,
    overrides?.operational ?? operational,
    payments,
    inventory,
  ].map((value) => vi.fn().mockResolvedValue(ok(value)));
  const render = vi.fn().mockImplementation(async () => {
    sequence.push("render");
    return {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
      extension: "pdf" as const,
    };
  });
  const record = vi.fn().mockImplementation(async () => {
    sequence.push("audit");
    return ok({});
  });
  const service = new ReportExportService(
    { read: reads[0] },
    { read: reads[1] },
    { read: reads[2] },
    { read: reads[3] },
    { pdf: { render }, xlsx: { render } },
    { record },
  );
  return { service, reads, render, record, sequence };
}

describe("ReportExportService", () => {
  it("re-reads every persisted report with one filter identity and audits after rendering", async () => {
    const fixture = setup();
    const result = await fixture.service.export(validInput);

    expect(result).toEqual({
      ok: true,
      value: {
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "application/pdf",
        extension: "pdf",
        filename: "reporte-2026-09-10.pdf",
      },
    });
    for (const read of fixture.reads) {
      expect(read).toHaveBeenCalledWith({
        actorId,
        restaurantId,
        date: identity.date,
        timeZone: identity.timeZone,
      });
    }
    expect(fixture.sequence).toEqual(["render", "audit"]);
    expect(fixture.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        action: "report.export",
        entityType: "restaurant_report",
        entityId: restaurantId,
        newValues: expect.objectContaining({
          format: "pdf",
          date: identity.date,
          periodStart: identity.periodStart,
          periodEnd: identity.periodEnd,
        }),
      }),
    );
    expect(JSON.stringify(fixture.record.mock.calls)).not.toContain("125.50");
  });

  it("rejects extra input before persisted reads", async () => {
    const fixture = setup();
    const result = await fixture.service.export({
      ...validInput,
      payload: daily,
    } as ReportExportInput);

    expect(result).toEqual({
      ok: false,
      error: { kind: "report-export-error", code: "INVALID_INPUT" },
    });
    expect(fixture.reads[0]).not.toHaveBeenCalled();
  });

  it("fails closed when independently read snapshots are not aligned", async () => {
    const fixture = setup({
      operational: {
        ...operational,
        periodEnd: "2026-09-12T05:00:00.000Z",
      },
    });
    const result = await fixture.service.export(validInput);

    expect(result.ok).toBe(false);
    expect(fixture.render).not.toHaveBeenCalled();
    expect(fixture.record).not.toHaveBeenCalled();
  });

  it("preserves active filters, every report section, source rows and totals with Spanish labels", () => {
    const document = buildReportExportDocument(
      daily,
      operational,
      payments,
      inventory,
    );
    expect(document.sections[0].rows[0][1]).toEqual({
      value: "125.50",
      kind: "money",
    });
    expect(
      document.sections.find((entry) => entry.title === "Ventas por categoría")
        ?.rows[0][0].value,
    ).toBe("Unattributed historical category");
    expect(document.restaurant).toEqual(identity.restaurant);
    expect(document.date).toBe(identity.date);
    expect(document.timeZone).toBe(identity.timeZone);
    expect(document.periodStart).toBe(identity.periodStart);
    expect(document.periodEnd).toBe(identity.periodEnd);
    expect(document.sections).toHaveLength(23);
    expect(
      document.sections.find((entry) => entry.title === "Ingresos por hora")
        ?.rows,
    ).toHaveLength(24);

    const artifactText = document.sections
      .flatMap((entry) =>
        entry.rows.flatMap((entry) => entry.map((cell) => cell.value)),
      )
      .join("\n");
    for (const expected of [
      "125.50",
      "Taco",
      "Efectivo histórico",
      "ORD-001",
      "REF-EXPORT",
      "Maíz histórico",
      "Proveedor histórico",
      "Masa histórica",
      "Conteo físico exportado",
      "Merma exportada",
      "Ingredientes históricos",
      "80.00",
      "Ingrediente crudo",
      "Consumo de producción",
      "Producción",
      "Compra de inventario",
    ]) {
      expect(artifactText).toContain(expected);
    }
    for (const machineValue of [
      "RAW_INGREDIENT",
      "PRODUCTION_CONSUMPTION",
      "PRODUCTION",
      "PURCHASE",
    ]) {
      expect(artifactText.split("\n")).not.toContain(machineValue);
    }
  });

  it("localizes every persisted inventory and expense machine enum", () => {
    const itemTypes = ["RAW_INGREDIENT", "PRODUCED_ITEM", "RESALE_ITEM"];
    const movements = [
      ["PURCHASE", "PURCHASE"],
      ["PRODUCTION_CONSUMPTION", "PRODUCTION"],
      ["PRODUCTION_OUTPUT", "PRODUCTION"],
      ["SALE", "SALE"],
      ["ADJUSTMENT", "ADJUSTMENT"],
      ["WASTE", "WASTE"],
      ["ROLLBACK", "ROLLBACK"],
    ] as const;
    const localizedInventory = {
      ...inventory,
      inventoryBalances: itemTypes.map((inventoryItemType) => ({
        ...inventory.inventoryBalances[0],
        inventoryItemType,
      })),
      movements: movements.map(([type, businessOriginType], index) => ({
        ...inventory.movements[0],
        id: `72000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        type,
        businessOriginType,
      })),
      expenses: ["MANUAL", "PURCHASE"].map((originType, index) => ({
        ...inventory.expenses[0],
        id: `75000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        originType,
      })),
    } as InventoryProductionExpenseReport;
    const document = buildReportExportDocument(
      daily,
      operational,
      payments,
      localizedInventory,
    );

    expect(
      sectionRows(document, "Existencias actuales").map((row) => row[1].value),
    ).toEqual([
      "Ingrediente crudo",
      "Producto elaborado",
      "Producto de reventa",
    ]);
    expect(
      sectionRows(document, "Movimientos de inventario").map(
        (row) => row[2].value,
      ),
    ).toEqual([
      "Compra",
      "Consumo de producción",
      "Salida de producción",
      "Venta",
      "Ajuste",
      "Desperdicio",
      "Reversión",
    ]);
    expect(
      sectionRows(document, "Movimientos de inventario").map(
        (row) => row[5].value,
      ),
    ).toEqual([
      "Compra",
      "Producción",
      "Producción",
      "Venta",
      "Ajuste",
      "Desperdicio",
      "Reversión",
    ]);
    expect(
      sectionRows(document, "Detalle de gastos del día").map(
        (row) => row[3].value,
      ),
    ).toEqual(["Registro manual", "Compra de inventario"]);
  });
});

function sectionRows(
  document: ReturnType<typeof buildReportExportDocument>,
  title: string,
) {
  const target = document.sections.find((entry) => entry.title === title);
  expect(target).toBeDefined();
  return target!.rows;
}
