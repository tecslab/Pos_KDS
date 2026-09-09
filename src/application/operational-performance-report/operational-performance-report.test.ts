import { describe, expect, it, vi } from "vitest";

import { REPORTING_TIME_ZONE } from "../daily-sales-report";
import {
  OperationalPerformanceReportService,
  UNATTRIBUTED_HISTORICAL_CATEGORY,
  type OperationalPerformanceReport,
  type OperationalPerformanceReportReader,
} from "./operational-performance-report";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";

function report(): OperationalPerformanceReport {
  return Object.freeze({
    restaurant: Object.freeze({ id: restaurantId, name: "Carnales" }),
    date: "2026-09-06",
    timeZone: REPORTING_TIME_ZONE,
    periodStart: "2026-09-06T05:00:00.000Z",
    periodEnd: "2026-09-07T05:00:00.000Z",
    productSales: Object.freeze([
      Object.freeze({
        productId: "20000000-0000-4000-8000-000000000001",
        productName: "Taco",
        quantitySold: 2,
        revenue: "10.00",
      }),
    ]),
    categorySales: Object.freeze([
      Object.freeze({
        categoryId: null,
        categoryName: UNATTRIBUTED_HISTORICAL_CATEGORY,
        quantitySold: 2,
        revenue: "10.00",
      }),
    ]),
    averagePreparationMinutes: "12.50",
    longestPreparationMinutes: "20.00",
    ordersCurrentlyInPreparation: 1,
    peakPreparationPeriods: Object.freeze(
      Array.from({ length: 24 }, (_, hour) =>
        Object.freeze({ hour, orders: 0 }),
      ),
    ),
    averageReadyToOnTheWayMinutes: "3.00",
    averageOnTheWayToDeliveredMinutes: "8.00",
    deliveredOrders: 2,
    ordersWaitingForDelivery: 1,
  });
}

function reader(value: OperationalPerformanceReport | null = report()) {
  return {
    read: vi.fn().mockResolvedValue(value),
  } satisfies OperationalPerformanceReportReader;
}

describe("OperationalPerformanceReportService", () => {
  it("uses the same approved business-day boundaries and preserves the legacy category label", async () => {
    const persistence = reader();
    await expect(
      new OperationalPerformanceReportService(persistence).read({
        actorId,
        restaurantId,
        date: "2026-09-06",
        timeZone: REPORTING_TIME_ZONE,
      }),
    ).resolves.toEqual({ ok: true, value: report() });
    expect(persistence.read).toHaveBeenCalledWith(
      expect.objectContaining({
        periodStart: "2026-09-06T05:00:00.000Z",
        periodEnd: "2026-09-07T05:00:00.000Z",
      }),
    );
    expect(report().categorySales[0].categoryName).toBe(
      UNATTRIBUTED_HISTORICAL_CATEGORY,
    );
  });

  it("rejects malformed report inputs before persistence", async () => {
    const persistence = reader();
    await expect(
      new OperationalPerformanceReportService(persistence).read({
        actorId,
        restaurantId,
        date: "2026-02-30",
        timeZone: REPORTING_TIME_ZONE,
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        kind: "operational-performance-report-error",
        code: "INVALID_INPUT",
      },
    });
    expect(persistence.read).not.toHaveBeenCalled();
  });

  it("fails closed when persistence tries to revise the requested reporting identity", async () => {
    const invalid = {
      ...report(),
      restaurant: { id: "30000000-0000-4000-8000-000000000009", name: "Other" },
    };
    await expect(
      new OperationalPerformanceReportService(reader(invalid)).read({
        actorId,
        restaurantId,
        date: "2026-09-06",
        timeZone: REPORTING_TIME_ZONE,
      }),
    ).resolves.toMatchObject({ ok: false });
  });
});
