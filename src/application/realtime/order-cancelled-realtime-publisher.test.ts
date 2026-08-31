import { describe, expect, it, vi } from "vitest";
import type { OrderCancelled } from "../../domain";
import { OrderCancelledRealtimePublisher } from "./order-cancelled-realtime-publisher";

describe("OrderCancelledRealtimePublisher", () => {
  it("maps the domain event to the order.cancelled realtime route", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const event: OrderCancelled = {
      type: "order.cancelled",
      occurredAt: "2026-08-30T10:00:00.000Z",
      payload: {
        orderId: "41000000-0000-4000-8000-000000000001",
        restaurantId: "30000000-0000-4000-8000-000000000001",
        serviceLocationId: "31000000-0000-4000-8000-000000000001",
        orderNumber: "ORD-42",
        assignedWaiterId: "10000000-0000-4000-8000-000000000002",
        previousStatus: "READY",
        status: "CANCELLED",
        totalAmount: "12.00",
        cancelledById: "10000000-0000-4000-8000-000000000001",
        reason: "Customer request",
        cancelledAt: "2026-08-30T10:00:00.000Z",
        updatedAt: "2026-08-30T10:00:00.000Z",
      },
    };
    await new OrderCancelledRealtimePublisher({ publish }).publish([event]);
    expect(publish).toHaveBeenCalledWith([
      {
        type: "order.cancelled",
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
            status: "CANCELLED",
            totalAmount: "12.00",
            cancelledById: event.payload.cancelledById,
            reason: "Customer request",
            cancelledAt: event.payload.cancelledAt,
            updatedAt: event.payload.updatedAt,
          },
        },
      },
    ]);
  });
});
