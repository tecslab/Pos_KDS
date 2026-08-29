import { describe, expect, it, vi } from "vitest";
import type { OrderUpdated } from "../../domain";
import { OrderUpdatedRealtimePublisher } from "./order-updated-realtime-publisher";

describe("OrderUpdatedRealtimePublisher", () => {
  it("maps the domain event to the existing order.modified route", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const event: OrderUpdated = {
      type: "order.updated",
      occurredAt: "2026-08-28T10:00:00.000Z",
      payload: {
        orderId: "41000000-0000-4000-8000-000000000001",
        restaurantId: "30000000-0000-4000-8000-000000000001",
        serviceLocationId: "31000000-0000-4000-8000-000000000001",
        orderNumber: "ORD-42",
        assignedWaiterId: "10000000-0000-4000-8000-000000000001",
        status: "PENDING",
        totalAmount: "12.00",
        updatedAt: "2026-08-28T10:00:00.000Z",
      },
    };
    await new OrderUpdatedRealtimePublisher({ publish }).publish([event]);
    expect(publish).toHaveBeenCalledWith([
      {
        type: "order.modified",
        occurredAt: event.occurredAt,
        payload: {
          restaurantId: event.payload.restaurantId,
          entityId: event.payload.orderId,
          entityType: "order",
          data: {
            serviceLocationId: event.payload.serviceLocationId,
            orderNumber: "ORD-42",
            assignedWaiterId: event.payload.assignedWaiterId,
            status: "PENDING",
            totalAmount: "12.00",
            updatedAt: event.payload.updatedAt,
          },
        },
      },
    ]);
  });
});
