import { describe, expect, it, vi } from "vitest";

import type { OrderOnTheWay } from "../../domain";
import { OrderOnTheWayRealtimePublisher } from "./order-on-the-way-realtime-publisher";

const event: OrderOnTheWay = {
  type: "order.on-the-way",
  occurredAt: "2026-09-01T10:00:00.000Z",
  payload: {
    orderId: "41000000-0000-4000-8000-000000000001",
    restaurantId: "30000000-0000-4000-8000-000000000001",
    serviceLocationId: "31000000-0000-4000-8000-000000000001",
    orderNumber: "ORD-42",
    assignedWaiterId: "10000000-0000-4000-8000-000000000002",
    previousStatus: "READY",
    status: "ON_THE_WAY",
    collectedById: "10000000-0000-4000-8000-000000000001",
    readyAt: "2026-09-01T09:55:00.000Z",
    onTheWayAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  },
};

describe("OrderOnTheWayRealtimePublisher", () => {
  it("maps the committed handoff to the shared delivery status event", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    await new OrderOnTheWayRealtimePublisher({ publish }).publish([event]);

    expect(publish).toHaveBeenCalledWith([
      {
        type: "delivery.status.updated",
        occurredAt: event.occurredAt,
        payload: {
          restaurantId: event.payload.restaurantId,
          entityId: event.payload.orderId,
          entityType: "order",
          data: {
            serviceLocationId: event.payload.serviceLocationId,
            orderNumber: "ORD-42",
            assignedWaiterId: event.payload.assignedWaiterId,
            previousStatus: "READY",
            status: "ON_THE_WAY",
            collectedById: event.payload.collectedById,
            readyAt: event.payload.readyAt,
            onTheWayAt: event.payload.onTheWayAt,
            updatedAt: event.payload.updatedAt,
          },
        },
      },
    ]);
    expect(JSON.stringify(publish.mock.calls)).not.toMatch(
      /total|price|balance|payment|amount/i,
    );
  });

  it("projects only operational fields from untrusted upstream payloads", async () => {
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
    } as unknown as OrderOnTheWay;

    await new OrderOnTheWayRealtimePublisher({ publish }).publish([
      eventWithFinancialData,
    ]);

    expect(JSON.stringify(publish.mock.calls)).not.toMatch(
      /total|price|balance|payment|amount/i,
    );
  });
});
