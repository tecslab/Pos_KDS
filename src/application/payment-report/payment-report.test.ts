import { describe, expect, it, vi } from "vitest";

import { REPORTING_TIME_ZONE } from "../daily-sales-report";
import {
  PaymentReportService,
  type PaymentReport,
  type PaymentReportReader,
} from "./payment-report";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const orderId = "40000000-0000-4000-8000-000000000001";
const basketId = "50000000-0000-4000-8000-000000000001";
const paymentId = "60000000-0000-4000-8000-000000000001";

function report(): PaymentReport {
  const balance = Object.freeze({
    orderId,
    orderNumber: "ORD-001",
    basketId,
    basketTotal: "20.00",
    paidAmount: "5.00",
    outstandingBalance: "15.00",
  });
  return Object.freeze({
    restaurant: Object.freeze({ id: restaurantId, name: "Carnales" }),
    date: "2026-09-06",
    timeZone: REPORTING_TIME_ZONE,
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
    outstandingBalances: Object.freeze([balance]),
    partialPayments: Object.freeze([balance]),
    paymentHistory: Object.freeze([
      Object.freeze({
        id: paymentId,
        orderId,
        orderNumber: "ORD-002",
        basketId: "50000000-0000-4000-8000-000000000002",
        amount: "10.00",
        paymentMethodCode: "CASH",
        paymentMethodName: "Efectivo",
        recordedById: actorId,
        recordedAt: "2026-09-06T18:00:00.000Z",
        referenceNumber: null,
        comments: "Pago de prueba",
        overageAuthorizedById: null,
        overageAuthorizedAt: null,
        overageReason: null,
      }),
    ]),
  });
}

function reader(value: PaymentReport | null = report()) {
  return {
    read: vi.fn().mockResolvedValue(value),
  } satisfies PaymentReportReader;
}

const input = {
  actorId,
  restaurantId,
  date: "2026-09-06",
  timeZone: REPORTING_TIME_ZONE,
};

describe("PaymentReportService", () => {
  it("uses the approved local-day boundary and accepts consistent persisted payment views", async () => {
    const persistence = reader();
    await expect(
      new PaymentReportService(persistence).read(input),
    ).resolves.toEqual({ ok: true, value: report() });
    expect(persistence.read).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        restaurantId,
        periodStart: "2026-09-06T05:00:00.000Z",
        periodEnd: "2026-09-07T05:00:00.000Z",
      }),
    );
  });

  it("rejects malformed input before persistence", async () => {
    const persistence = reader();
    await expect(
      new PaymentReportService(persistence).read({ ...input, date: "bad" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(persistence.read).not.toHaveBeenCalled();
  });

  it("fails closed when persisted totals disagree with immutable detail", async () => {
    const invalid = { ...report(), totalRevenue: "9.99" };
    await expect(
      new PaymentReportService(reader(invalid)).read(input),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
  });

  it("fails closed when a partial-payment row is not the matching outstanding row", async () => {
    const invalid = {
      ...report(),
      partialPayments: [
        { ...report().partialPayments[0], outstandingBalance: "14.00" },
      ],
    };
    await expect(
      new PaymentReportService(reader(invalid)).read(input),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
  });

  it("maps persistence authorization denial without exposing details", async () => {
    const persistence = reader();
    persistence.read.mockRejectedValue({ persistenceCode: "42501" });
    await expect(
      new PaymentReportService(persistence).read(input),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "payment-report-error", code: "UNAUTHORIZED" },
    });
  });
});
