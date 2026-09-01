import { describe, expect, it, vi } from "vitest";

import type { OrderReady } from "../../domain";
import { OrderReadyRealtimePublisher } from "./order-ready-realtime-publisher";

const event: OrderReady = {
  type: "order.ready",
  occurredAt: "2026-09-01T10:00:00.000Z",
  payload: {
    orderId: "41000000-0000-4000-8000-000000000001",
    restaurantId: "30000000-0000-4000-8000-000000000001",
    serviceLocationId: "31000000-0000-4000-8000-000000000001",
    orderNumber: "ORD-42",
    assignedWaiterId: "10000000-0000-4000-8000-000000000002",
    previousStatus: "PENDING",
    status: "READY",
    markedReadyById: "10000000-0000-4000-8000-000000000001",
    readyAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  },
};

describe("OrderReadyRealtimePublisher", () => {
  it("maps OrderReady to the shared kitchen status event", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    await new OrderReadyRealtimePublisher({ publish }).publish([event]);

    expect(publish).toHaveBeenCalledWith([
      {
        type: "kitchen.status.updated",
        occurredAt: event.occurredAt,
        payload: {
          restaurantId: event.payload.restaurantId,
          entityId: event.payload.orderId,
          entityType: "order",
          data: {
            serviceLocationId: event.payload.serviceLocationId,
            orderNumber: "ORD-42",
            assignedWaiterId: event.payload.assignedWaiterId,
            previousStatus: "PENDING",
            status: "READY",
            markedReadyById: event.payload.markedReadyById,
            readyAt: event.payload.readyAt,
            updatedAt: event.payload.updatedAt,
          },
        },
      },
    ]);
    expect(JSON.stringify(publish.mock.calls)).not.toMatch(
      /total|price|balance|payment|amount/i,
    );
  });

  it("projects only operational fields when an upstream event has financial data", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const eventWithFinancialData = {
      ...event,
      payload: {
        ...event.payload,
        totalAmount: "12.00",
        outstandingBalance: "8.00",
        paymentStatus: "PARTIALLY_PAID",
        unitPrice: "6.00",
      },
    } as unknown as OrderReady;

    await new OrderReadyRealtimePublisher({ publish }).publish([
      eventWithFinancialData,
    ]);

    expect(JSON.stringify(publish.mock.calls)).not.toMatch(
      /total|price|balance|payment|amount/i,
    );
  });
});
