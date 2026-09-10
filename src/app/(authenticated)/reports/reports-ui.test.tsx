import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createService: vi.fn(),
  createOperationalService: vi.fn(),
  createPaymentService: vi.fn(),
  listRestaurants: vi.fn(),
  read: vi.fn(),
  operationalRead: vi.fn(),
  paymentRead: vi.fn(),
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

beforeEach(() => {
  dependencies.authorize.mockReset().mockResolvedValue({ userId: actorId });
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
});
