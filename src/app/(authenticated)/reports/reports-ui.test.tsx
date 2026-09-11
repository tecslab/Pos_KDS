import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createService: vi.fn(),
  createOperationalService: vi.fn(),
  createPaymentService: vi.fn(),
  createInventoryProductionExpenseService: vi.fn(),
  listRestaurants: vi.fn(),
  read: vi.fn(),
  operationalRead: vi.fn(),
  paymentRead: vi.fn(),
  inventoryProductionExpenseRead: vi.fn(),
}));

vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerPermission: dependencies.authorize,
}));
vi.mock("@/lib/daily-sales-report/server", () => ({
  createDailySalesReportService: dependencies.createService,
}));
vi.mock("@/lib/operational-performance-report/server", () => ({
  createOperationalPerformanceReportService:
    dependencies.createOperationalService,
}));
vi.mock("@/lib/payment-report/server", () => ({
  createPaymentReportService: dependencies.createPaymentService,
}));
vi.mock("@/lib/inventory-production-expense-report/server", () => ({
  createInventoryProductionExpenseReportService:
    dependencies.createInventoryProductionExpenseService,
}));
vi.mock("@/application", () => ({
  currentGuayaquilDate: () => "2026-09-06",
  REPORTING_TIME_ZONE: "America/Guayaquil",
}));

import ReportsPage from "./page";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const restaurants = Object.freeze([
  Object.freeze({ id: restaurantId, name: "Carnales Centro" }),
]);
const report = Object.freeze({
  restaurant: restaurants[0],
  date: "2026-09-06",
  timeZone: "America/Guayaquil" as const,
  periodStart: "2026-09-06T05:00:00.000Z",
  periodEnd: "2026-09-07T05:00:00.000Z",
  totalRevenue: "342.50",
  ordersCreated: 48,
  ordersCompleted: 42,
  averageTicket: "8.15",
  hourlyRevenue: Object.freeze(
    Array.from({ length: 24 }, (_, hour) =>
      Object.freeze({ hour, amount: hour === 12 ? "342.50" : "0.00" }),
    ),
  ),
});
const operationalReport = Object.freeze({
  restaurant: restaurants[0],
  date: "2026-09-06",
  timeZone: "America/Guayaquil" as const,
  periodStart: "2026-09-06T05:00:00.000Z",
  periodEnd: "2026-09-07T05:00:00.000Z",
  productSales: Object.freeze([]),
  categorySales: Object.freeze([]),
  averagePreparationMinutes: "12.00",
  longestPreparationMinutes: "15.00",
  ordersCurrentlyInPreparation: 1,
  peakPreparationPeriods: Object.freeze(
    Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 })),
  ),
  averageReadyToOnTheWayMinutes: "3.00",
  averageOnTheWayToDeliveredMinutes: "8.00",
  deliveredOrders: 2,
  ordersWaitingForDelivery: 1,
});
const populatedOperationalReport = Object.freeze({
  ...operationalReport,
  productSales: Object.freeze([
    Object.freeze({
      productId: "20000000-0000-4000-8000-000000000001",
      productName: "Taco al pastor",
      quantitySold: 7,
      revenue: "42.00",
    }),
  ]),
  categorySales: Object.freeze([
    Object.freeze({
      categoryId: null,
      categoryName: "Unattributed historical category",
      quantitySold: 7,
      revenue: "42.00",
    }),
  ]),
});
const paymentBalance = Object.freeze({
  orderId: "40000000-0000-4000-8000-000000000001",
  orderNumber: "ORD-001",
  basketId: "50000000-0000-4000-8000-000000000001",
  basketTotal: "20.00",
  paidAmount: "5.00",
  outstandingBalance: "15.00",
});
const paymentReport = Object.freeze({
  restaurant: restaurants[0],
  date: "2026-09-06",
  timeZone: "America/Guayaquil" as const,
  periodStart: "2026-09-06T05:00:00.000Z",
  periodEnd: "2026-09-07T05:00:00.000Z",
  totalRevenue: "10.00",
  totalOutstanding: "15.00",
  revenueByMethod: Object.freeze([
    Object.freeze({
      paymentMethodCode: "CASH",
      paymentMethodName: "Efectivo",
      paymentCount: 1,
      amount: "10.00",
    }),
  ]),
  outstandingBalances: Object.freeze([paymentBalance]),
  partialPayments: Object.freeze([paymentBalance]),
  paymentHistory: Object.freeze([
    Object.freeze({
      id: "60000000-0000-4000-8000-000000000001",
      orderId: "40000000-0000-4000-8000-000000000002",
      orderNumber: "ORD-002",
      basketId: "50000000-0000-4000-8000-000000000002",
      amount: "10.00",
      paymentMethodCode: "CASH",
      paymentMethodName: "Efectivo",
      recordedById: actorId,
      recordedAt: "2026-09-06T18:05:06.000Z",
      referenceNumber: "REF-001",
      comments: "Pago parcial",
      overageAuthorizedById: null,
      overageAuthorizedAt: null,
      overageReason: null,
    }),
  ]),
});
const inventoryProductionExpenseReport = Object.freeze({
  restaurant: restaurants[0],
  date: "2026-09-06",
  timeZone: "America/Guayaquil" as const,
  periodStart: "2026-09-06T05:00:00.000Z",
  periodEnd: "2026-09-07T05:00:00.000Z",
  monthStart: "2026-09-01T05:00:00.000Z",
  monthEnd: "2026-10-01T05:00:00.000Z",
  inventoryBalances: Object.freeze([
    Object.freeze({
      inventoryItemId: "40000000-0000-4000-8000-000000000001",
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
      id: "41000000-0000-4000-8000-000000000001",
      inventoryItemId: "40000000-0000-4000-8000-000000000001",
      inventoryItemName: "Maíz",
      unitOfMeasure: "kg",
      threshold: "5.000",
      observedBalance: "4.000",
      openedAt: "2026-09-06T10:00:00.000Z",
    }),
  ]),
  movements: Object.freeze([
    Object.freeze({
      id: "42000000-0000-4000-8000-000000000001",
      inventoryItemId: "40000000-0000-4000-8000-000000000001",
      inventoryItemName: "Maíz",
      type: "ADJUSTMENT" as const,
      quantityDelta: "1.000",
      unitOfMeasure: "kg",
      recordedById: actorId,
      recordedAt: "2026-09-06T10:00:00.000Z",
      businessOriginType: "ADJUSTMENT",
      businessOriginId: "43000000-0000-4000-8000-000000000001",
      comments: null,
      reversedMovementId: null,
    }),
  ]),
  purchases: Object.freeze([]),
  productionBatches: Object.freeze([]),
  adjustments: Object.freeze([
    Object.freeze({
      id: "43000000-0000-4000-8000-000000000001",
      inventoryItemId: "40000000-0000-4000-8000-000000000001",
      inventoryItemName: "Maíz",
      inventoryMovementId: "42000000-0000-4000-8000-000000000001",
      quantity: "1.000",
      unitOfMeasure: "kg",
      reason: "Conteo físico",
      recordedById: actorId,
      recordedAt: "2026-09-06T10:00:00.000Z",
    }),
  ]),
  wasteRecords: Object.freeze([]),
  expenses: Object.freeze([
    Object.freeze({
      id: "44000000-0000-4000-8000-000000000001",
      amount: "8.50",
      description: "Gas",
      incurredAt: "2026-09-06T11:00:00.000Z",
      recordedAt: "2026-09-06T11:00:00.000Z",
      recordedById: actorId,
      referenceNumber: null,
      comments: null,
      expenseCategoryCode: "UTILITIES",
      expenseCategoryName: "Servicios",
      originType: "MANUAL" as const,
      originId: null,
    }),
  ]),
  dailyExpenseTotal: "8.50",
  monthlyExpenseTotal: "8.50",
  dailyExpensesByCategory: Object.freeze([
    Object.freeze({
      expenseCategoryCode: "UTILITIES",
      expenseCategoryName: "Servicios",
      amount: "8.50",
    }),
  ]),
  monthlyExpensesByCategory: Object.freeze([
    Object.freeze({
      expenseCategoryCode: "UTILITIES",
      expenseCategoryName: "Servicios",
      amount: "8.50",
    }),
  ]),
  monthlyExpensesByDay: Object.freeze(
    Array.from({ length: 30 }, (_, index) =>
      Object.freeze({
        date: `2026-09-${String(index + 1).padStart(2, "0")}`,
        amount: index === 5 ? "8.50" : "0.00",
      }),
    ),
  ),
});

beforeEach(() => {
  dependencies.authorize.mockReset().mockResolvedValue({
    userId: actorId,
    permissionCodes: ["reports.view"],
  });
  dependencies.createService.mockReset().mockReturnValue({
    listRestaurants: dependencies.listRestaurants,
    read: dependencies.read,
  });
  dependencies.createOperationalService.mockReset().mockReturnValue({
    read: dependencies.operationalRead,
  });
  dependencies.createPaymentService.mockReset().mockReturnValue({
    read: dependencies.paymentRead,
  });
  dependencies.createInventoryProductionExpenseService
    .mockReset()
    .mockReturnValue({ read: dependencies.inventoryProductionExpenseRead });
  dependencies.listRestaurants.mockReset().mockResolvedValue({
    ok: true,
    value: restaurants,
  });
  dependencies.read.mockReset().mockResolvedValue({ ok: true, value: report });
  dependencies.operationalRead
    .mockReset()
    .mockResolvedValue({ ok: true, value: operationalReport });
  dependencies.paymentRead
    .mockReset()
    .mockResolvedValue({ ok: true, value: paymentReport });
  dependencies.inventoryProductionExpenseRead
    .mockReset()
    .mockResolvedValue({ ok: true, value: inventoryProductionExpenseReport });
});

async function render(params: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await ReportsPage({ searchParams: Promise.resolve(params) }),
  );
}

describe("daily sales dashboard UI", () => {
  it("authorizes at the page boundary before composing or reading report data", async () => {
    const markup = await render({ date: "2026-09-06", restaurantId });

    expect(dependencies.authorize).toHaveBeenCalledWith(
      "reports.view",
      "/reports",
    );
    expect(dependencies.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.createService.mock.invocationCallOrder[0],
    );
    expect(dependencies.read).toHaveBeenCalledWith({
      actorId,
      restaurantId,
      date: "2026-09-06",
      timeZone: "America/Guayaquil",
    });
    expect(dependencies.operationalRead).toHaveBeenCalledWith({
      actorId,
      restaurantId,
      date: "2026-09-06",
      timeZone: "America/Guayaquil",
    });
    expect(dependencies.paymentRead).toHaveBeenCalledWith({
      actorId,
      restaurantId,
      date: "2026-09-06",
      timeZone: "America/Guayaquil",
    });
    expect(dependencies.inventoryProductionExpenseRead).toHaveBeenCalledWith({
      actorId,
      restaurantId,
      date: "2026-09-06",
      timeZone: "America/Guayaquil",
    });
    expect(markup).toContain("Ventas del día");
    expect(markup).toContain("$342,50");
    expect(markup).toContain("Órdenes creadas");
    expect(markup).toContain(">48<");
    expect(markup).toContain("Órdenes completadas");
    expect(markup).toContain("Ticket promedio");
  });

  it("does not compose data services after authorization denial", async () => {
    dependencies.authorize.mockRejectedValue(new Error("unauthorized"));

    await expect(render({ date: "2026-09-06", restaurantId })).rejects.toThrow(
      "unauthorized",
    );
    expect(dependencies.createService).not.toHaveBeenCalled();
  });

  it("renders accessible 48px filters and a complete hourly table", async () => {
    const markup = await render({ date: "2026-09-06", restaurantId });

    expect(markup).toContain('for="report-restaurant"');
    expect(markup).toContain('for="report-date"');
    expect(markup).toContain('type="date"');
    expect(markup).toContain("min-h-12");
    expect(markup).toContain("Ingresos cobrados en cada hora local");
    expect(markup).toContain("00:00");
    expect(markup).toContain("23:00");
    expect(markup.match(/>\d{2}:00<\/th>/g)).toHaveLength(24);
  });

  it("shows export controls only when reports.export is granted", async () => {
    expect(await render({ date: "2026-09-06", restaurantId })).not.toContain(
      "Descargar PDF",
    );

    dependencies.authorize.mockResolvedValue({
      userId: actorId,
      permissionCodes: ["reports.view", "reports.export"],
    });
    const markup = await render({ date: "2026-09-06", restaurantId });
    expect(markup).toContain("Descargar PDF");
    expect(markup).toContain("Descargar Excel");
  });

  it("shows a safe accessible error for invalid or failed report input", async () => {
    dependencies.read.mockResolvedValue({
      ok: false,
      error: { code: "INVALID_INPUT", detail: "private" },
    });

    const markup = await render({ date: "bad", restaurantId });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(
      "La fecha o el restaurante seleccionado no es válido",
    );
    expect(markup).not.toContain("private");
  });

  it("renders the all-zero persisted day without omitting any hour", async () => {
    dependencies.read.mockResolvedValue({
      ok: true,
      value: {
        ...report,
        totalRevenue: "0.00",
        ordersCreated: 0,
        ordersCompleted: 0,
        averageTicket: "0.00",
        hourlyRevenue: report.hourlyRevenue.map((bucket) => ({
          ...bucket,
          amount: "0.00",
        })),
      },
    });

    const markup = await render({ date: "2026-09-06", restaurantId });
    expect(markup.match(/>\d{2}:00<\/th>/g)).toHaveLength(24);
    expect(markup).toContain("$0,00");
  });

  it("renders nonempty persisted product, category, kitchen, and delivery metrics", async () => {
    dependencies.operationalRead.mockResolvedValue({
      ok: true,
      value: populatedOperationalReport,
    });

    const markup = await render({ date: "2026-09-06", restaurantId });
    expect(markup).toContain("Productos más vendidos");
    expect(markup).toContain("Taco al pastor");
    expect(markup).toContain("Unattributed historical category");
    expect(markup).toContain("$42,00");
    expect(markup).toContain("Preparación");
    expect(markup).toContain("12.00 min");
    expect(markup).toContain("Tiempos y cuellos de botella");
    expect(markup).toContain("3.00 min");
    expect(markup).toContain("8.00 min");
    expect(markup).toContain("Esperando entrega");
  });

  it("shows a safe accessible failure when the operational report cannot load", async () => {
    dependencies.operationalRead.mockResolvedValue({
      ok: false,
      error: { code: "OPERATION_FAILED", detail: "private database details" },
    });

    const markup = await render({ date: "2026-09-06", restaurantId });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("No se pudo cargar el reporte operativo");
    expect(markup).not.toContain("private database details");
  });

  it("renders revenue by immutable method snapshot, end-of-day balances, partial payments, and payment history", async () => {
    const markup = await render({ date: "2026-09-06", restaurantId });

    expect(markup).toContain("Conciliación de pagos");
    expect(markup).toContain("Ingresos por método");
    expect(markup).toContain("Efectivo");
    expect(markup).toContain("Saldos pendientes al cierre");
    expect(markup).toContain("Pagos parciales al cierre");
    expect(markup).toContain("Historial inmutable de pagos");
    expect(markup).toContain("ORD-001");
    expect(markup).toContain("ORD-002");
    expect(markup).toContain("REF-001");
    expect(markup).toContain("Pago parcial");
    expect(markup).toContain("13:05:06");
    expect(markup).toContain("overflow-x-auto");
  });

  it("renders explicit empty payment-report states", async () => {
    dependencies.paymentRead.mockResolvedValue({
      ok: true,
      value: {
        ...paymentReport,
        totalRevenue: "0.00",
        totalOutstanding: "0.00",
        revenueByMethod: [],
        outstandingBalances: [],
        partialPayments: [],
        paymentHistory: [],
      },
    });

    const markup = await render({ date: "2026-09-06", restaurantId });
    expect(markup).toContain("No había saldos pendientes");
    expect(markup).toContain("No había canastas parcialmente pagadas");
    expect(markup.match(/No se registraron pagos en el día/g)).toHaveLength(2);
  });

  it("shows a safe accessible failure when the payment report cannot load", async () => {
    dependencies.paymentRead.mockResolvedValue({
      ok: false,
      error: { code: "OPERATION_FAILED", detail: "private database details" },
    });

    const markup = await render({ date: "2026-09-06", restaurantId });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("No se pudo cargar el reporte de pagos");
    expect(markup).not.toContain("private database details");
  });

  it("renders current inventory, immutable day activity, and expense summaries", async () => {
    const markup = await render({ date: "2026-09-06", restaurantId });

    expect(markup).toContain("Existencias, producción y gastos");
    expect(markup).toContain("Existencias actuales");
    expect(markup).toContain("Alertas activas de stock");
    expect(markup).toContain("Maíz");
    expect(markup).toContain("Bajo mínimo");
    expect(markup).toContain("Movimientos inmutables del día");
    expect(markup).toContain("Conteo físico");
    expect(markup).toContain("Gastos operativos");
    expect(markup).toContain("Servicios");
    expect(markup).toContain("$8,50");
    expect(markup).toContain("Totales diarios del mes");
    expect(markup).toContain("2026-09-30");
  });

  it("shows a safe accessible failure when the inventory and expense report cannot load", async () => {
    dependencies.inventoryProductionExpenseRead.mockResolvedValue({
      ok: false,
      error: { code: "OPERATION_FAILED", detail: "private database details" },
    });

    const markup = await render({ date: "2026-09-06", restaurantId });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(
      "No se pudo cargar el reporte de inventario, producción y gastos",
    );
    expect(markup).not.toContain("private database details");
  });
});
