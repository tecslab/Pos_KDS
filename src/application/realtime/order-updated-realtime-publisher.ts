import type { OrderUpdated } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { RealtimeDomainEvent } from "./realtime-event";

/** Adapts committed order modifications to the provider-neutral realtime API. */
export class OrderUpdatedRealtimePublisher implements DomainEventPublisher<OrderUpdated> {
  constructor(
    private readonly publisher: DomainEventPublisher<RealtimeDomainEvent>,
  ) {}

  async publish(events: readonly OrderUpdated[]): Promise<void> {
    await this.publisher.publish(
      Object.freeze(
        events.map((event) =>
          Object.freeze({
            type: "order.modified" as const,
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
                updatedAt: event.payload.updatedAt,
              }),
            }),
          }),
        ),
      ),
    );
  }
}
