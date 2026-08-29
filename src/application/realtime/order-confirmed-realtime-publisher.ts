import type { OrderConfirmed } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";

import type { RealtimeDomainEvent } from "./realtime-event";

/** Adapts committed order confirmations to the provider-neutral realtime API. */
export class OrderConfirmedRealtimePublisher implements DomainEventPublisher<OrderConfirmed> {
  constructor(
    private readonly publisher: DomainEventPublisher<RealtimeDomainEvent>,
  ) {}

  async publish(events: readonly OrderConfirmed[]): Promise<void> {
    const realtimeEvents = events.map((event) =>
      Object.freeze({
        type: "order.created" as const,
        occurredAt: event.occurredAt,
        payload: Object.freeze({
          restaurantId: event.payload.restaurantId,
          entityId: event.payload.orderId,
          entityType: "order",
          data: Object.freeze({
            serviceLocationId: event.payload.serviceLocationId,
            orderNumber: event.payload.orderNumber,
            assignedWaiterId: event.payload.assignedWaiterId,
            status: event.payload.status,
            totalAmount: event.payload.totalAmount,
          }),
        }),
      }),
    );

    await this.publisher.publish(Object.freeze(realtimeEvents));
  }
}
