import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createService: vi.fn(),
  listRestaurants: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerPermission: dependencies.authorize,
}));
vi.mock("@/lib/daily-sales-report/server", () => ({
  createDailySalesReportService: dependencies.createService,
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

beforeEach(() => {
  dependencies.authorize.mockReset().mockResolvedValue({ userId: actorId });
  dependencies.createService.mockReset().mockReturnValue({
    listRestaurants: dependencies.listRestaurants,
    read: dependencies.read,
  });
  dependencies.listRestaurants.mockReset().mockResolvedValue({
    ok: true,
    value: restaurants,
  });
  dependencies.read.mockReset().mockResolvedValue({ ok: true, value: report });
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
    expect(markup.match(/scope="row"/g)).toHaveLength(24);
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
    expect(markup.match(/scope="row"/g)).toHaveLength(24);
    expect(markup).toContain("$0,00");
  });
});
