import { describe, expect, it, vi } from "vitest";

import {
  DailySalesReportService,
  REPORTING_TIME_ZONE,
  currentGuayaquilDate,
  parseDailySalesReportQuery,
  type DailySalesReport,
  type DailySalesReportReader,
} from "./daily-sales-report";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";

function report(): DailySalesReport {
  return Object.freeze({
    restaurant: Object.freeze({ id: restaurantId, name: "Carnales" }),
    date: "2026-09-06",
    timeZone: REPORTING_TIME_ZONE,
    periodStart: "2026-09-06T05:00:00.000Z",
    periodEnd: "2026-09-07T05:00:00.000Z",
    totalRevenue: "42.50",
    ordersCreated: 4,
    ordersCompleted: 2,
    averageTicket: "21.25",
    hourlyRevenue: Object.freeze(
      Array.from({ length: 24 }, (_, hour) =>
        Object.freeze({ hour, amount: hour === 12 ? "42.50" : "0.00" }),
      ),
    ),
  });
}

function reader(value: DailySalesReport | null = report()) {
  return {
    listRestaurants: vi
      .fn()
      .mockResolvedValue([
        Object.freeze({ id: restaurantId, name: "Carnales" }),
      ]),
    read: vi.fn().mockResolvedValue(value),
  } satisfies DailySalesReportReader;
}

describe("DailySalesReportService", () => {
  it("resolves the approved Guayaquil calendar day to UTC half-open boundaries", async () => {
    const persistence = reader();
    const result = await new DailySalesReportService(persistence).read({
      actorId,
      restaurantId,
      date: "2026-09-06",
      timeZone: REPORTING_TIME_ZONE,
    });

    expect(result).toEqual({ ok: true, value: report() });
    expect(persistence.read).toHaveBeenCalledWith({
      actorId,
      restaurantId,
      date: "2026-09-06",
      timeZone: REPORTING_TIME_ZONE,
      periodStart: "2026-09-06T05:00:00.000Z",
      periodEnd: "2026-09-07T05:00:00.000Z",
    });
  });

  it.each([
    ["2026-02-30", REPORTING_TIME_ZONE],
    ["2026-9-06", REPORTING_TIME_ZONE],
    ["2026-09-06T00:00:00Z", REPORTING_TIME_ZONE],
    ["2026-09-06", "UTC"],
  ])(
    "rejects invalid date/timezone input %s %s before persistence",
    async (date, timeZone) => {
      const persistence = reader();
      const result = await new DailySalesReportService(persistence).read({
        actorId,
        restaurantId,
        date,
        timeZone,
      });

      expect(result).toEqual({
        ok: false,
        error: { kind: "daily-sales-report-error", code: "INVALID_INPUT" },
      });
      expect(persistence.read).not.toHaveBeenCalled();
    },
  );

  it("accepts leap day and calculates the next calendar boundary", () => {
    expect(
      parseDailySalesReportQuery({
        actorId,
        restaurantId,
        date: "2028-02-29",
        timeZone: REPORTING_TIME_ZONE,
      }),
    ).toMatchObject({
      periodStart: "2028-02-29T05:00:00.000Z",
      periodEnd: "2028-03-01T05:00:00.000Z",
    });
  });

  it("accepts an all-zero persisted day with exactly 24 hourly buckets", async () => {
    const zero = Object.freeze({
      ...report(),
      totalRevenue: "0.00",
      ordersCreated: 0,
      ordersCompleted: 0,
      averageTicket: "0.00",
      hourlyRevenue: Object.freeze(
        Array.from({ length: 24 }, (_, hour) =>
          Object.freeze({ hour, amount: "0.00" }),
        ),
      ),
    });

    await expect(
      new DailySalesReportService(reader(zero)).read({
        actorId,
        restaurantId,
        date: "2026-09-06",
        timeZone: REPORTING_TIME_ZONE,
      }),
    ).resolves.toEqual({ ok: true, value: zero });
  });

  it("fails closed when persistence returns another restaurant or malformed buckets", async () => {
    const invalid = Object.freeze({
      ...report(),
      restaurant: Object.freeze({
        id: "30000000-0000-4000-8000-000000000099",
        name: "Other",
      }),
      hourlyRevenue: report().hourlyRevenue.slice(1),
    });

    await expect(
      new DailySalesReportService(reader(invalid)).read({
        actorId,
        restaurantId,
        date: "2026-09-06",
        timeZone: REPORTING_TIME_ZONE,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "daily-sales-report-error", code: "OPERATION_FAILED" },
    });
  });

  it("returns only valid available restaurant identities", async () => {
    await expect(
      new DailySalesReportService(reader()).listRestaurants(),
    ).resolves.toEqual({
      ok: true,
      value: [{ id: restaurantId, name: "Carnales" }],
    });
  });
});

describe("currentGuayaquilDate", () => {
  it("does not use the runtime local date around the Guayaquil midnight boundary", () => {
    expect(currentGuayaquilDate(new Date("2026-09-07T04:59:59.999Z"))).toBe(
      "2026-09-06",
    );
    expect(currentGuayaquilDate(new Date("2026-09-07T05:00:00.000Z"))).toBe(
      "2026-09-07",
    );
  });
});
