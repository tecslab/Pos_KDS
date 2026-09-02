import { describe, expect, it, vi } from "vitest";

import type { OrderDelivered } from "../../domain";
import { OrderDeliveredRealtimePublisher } from "./order-delivered-realtime-publisher";

const event: OrderDelivered = {
  type: "order.delivered",
  occurredAt: "2026-09-01T10:05:00.000Z",
  payload: {
    orderId: "41000000-0000-4000-8000-000000000001",
    restaurantId: "30000000-0000-4000-8000-000000000001",
    serviceLocationId: "31000000-0000-4000-8000-000000000001",
    orderNumber: "ORD-42",
    assignedWaiterId: "10000000-0000-4000-8000-000000000002",
    previousStatus: "ON_THE_WAY",
    status: "DELIVERED",
    deliveredById: "10000000-0000-4000-8000-000000000001",
    readyAt: "2026-09-01T09:55:00.000Z",
    onTheWayAt: "2026-09-01T10:00:00.000Z",
    deliveredAt: "2026-09-01T10:05:00.000Z",
    updatedAt: "2026-09-01T10:05:00.000Z",
  },
};

describe("OrderDeliveredRealtimePublisher", () => {
  it("maps the committed delivery to the shared delivery status event", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    await new OrderDeliveredRealtimePublisher({ publish }).publish([event]);

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
            previousStatus: "ON_THE_WAY",
            status: "DELIVERED",
            deliveredById: event.payload.deliveredById,
            readyAt: event.payload.readyAt,
            onTheWayAt: event.payload.onTheWayAt,
            deliveredAt: event.payload.deliveredAt,
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
    } as unknown as OrderDelivered;

    await new OrderDeliveredRealtimePublisher({ publish }).publish([
      eventWithFinancialData,
    ]);

    expect(JSON.stringify(publish.mock.calls)).not.toMatch(
      /total|price|balance|payment|amount/i,
    );
  });
});
