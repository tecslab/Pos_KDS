import { describe, expect, it, vi } from "vitest";

import type { OrderConfirmed } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";

import type { RealtimeDomainEvent } from "./realtime-event";
import { OrderConfirmedRealtimePublisher } from "./order-confirmed-realtime-publisher";

const confirmedEvent: OrderConfirmed = Object.freeze({
  type: "order.confirmed",
  occurredAt: "2026-08-25T10:00:00.000Z",
  payload: Object.freeze({
    orderId: "41000000-0000-4000-8000-000000000001",
    restaurantId: "30000000-0000-4000-8000-000000000001",
    serviceLocationId: "31000000-0000-4000-8000-000000000001",
    orderNumber: "ORD-42",
    assignedWaiterId: "10000000-0000-4000-8000-000000000001",
    status: "PENDING",
    totalAmount: "10.00",
  }),
});

describe("OrderConfirmedRealtimePublisher", () => {
  it("adapts confirmations and delegates the batch exactly once", async () => {
    const publish =
      vi.fn<DomainEventPublisher<RealtimeDomainEvent>["publish"]>();
    const adapter = new OrderConfirmedRealtimePublisher({ publish });

    await adapter.publish([confirmedEvent]);

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith([
      {
        type: "order.created",
        occurredAt: confirmedEvent.occurredAt,
        payload: {
          restaurantId: confirmedEvent.payload.restaurantId,
          entityId: confirmedEvent.payload.orderId,
          entityType: "order",
          data: {
            serviceLocationId: confirmedEvent.payload.serviceLocationId,
            orderNumber: confirmedEvent.payload.orderNumber,
            assignedWaiterId: confirmedEvent.payload.assignedWaiterId,
            status: "PENDING",
            totalAmount: "10.00",
          },
        },
      },
    ]);
    const delegated = publish.mock.calls[0]?.[0];
    expect(Object.isFrozen(delegated)).toBe(true);
    expect(Object.isFrozen(delegated?.[0]?.payload.data)).toBe(true);
  });

  it("propagates publication rejection without retrying", async () => {
    const rejection = new Error("provider detail");
    const publish = vi
      .fn<DomainEventPublisher<RealtimeDomainEvent>["publish"]>()
      .mockRejectedValue(rejection);
    const adapter = new OrderConfirmedRealtimePublisher({ publish });

    await expect(adapter.publish([confirmedEvent])).rejects.toBe(rejection);
    expect(publish).toHaveBeenCalledOnce();
  });
});
