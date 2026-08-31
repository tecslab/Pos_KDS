import type { OrderCancelled } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { RealtimeDomainEvent } from "./realtime-event";

/** Adapts committed order cancellations to the provider-neutral realtime API. */
export class OrderCancelledRealtimePublisher implements DomainEventPublisher<OrderCancelled> {
  constructor(
    private readonly publisher: DomainEventPublisher<RealtimeDomainEvent>,
  ) {}

  async publish(events: readonly OrderCancelled[]): Promise<void> {
    await this.publisher.publish(
      Object.freeze(
        events.map((event) =>
          Object.freeze({
            type: "order.cancelled" as const,
            occurredAt: event.occurredAt,
            payload: Object.freeze({
              restaurantId: event.payload.restaurantId,
              entityId: event.payload.orderId,
              entityType: "order",
              data: Object.freeze({
                serviceLocationId: event.payload.serviceLocationId,
                orderNumber: event.payload.orderNumber,
                assignedWaiterId: event.payload.assignedWaiterId,
                previousStatus: event.payload.previousStatus,
                status: event.payload.status,
                totalAmount: event.payload.totalAmount,
                cancelledById: event.payload.cancelledById,
                reason: event.payload.reason,
                cancelledAt: event.payload.cancelledAt,
                updatedAt: event.payload.updatedAt,
              }),
            }),
          }),
        ),
      ),
    );
  }
}
