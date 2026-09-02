import type { OrderDelivered } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { RealtimeDomainEvent } from "./realtime-event";

/** Adapts committed deliveries to the shared delivery-status realtime API. */
export class OrderDeliveredRealtimePublisher implements DomainEventPublisher<OrderDelivered> {
  constructor(
    private readonly publisher: DomainEventPublisher<RealtimeDomainEvent>,
  ) {}

  async publish(events: readonly OrderDelivered[]): Promise<void> {
    await this.publisher.publish(
      Object.freeze(
        events.map((event) =>
          Object.freeze({
            type: "delivery.status.updated" as const,
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
                deliveredById: event.payload.deliveredById,
                readyAt: event.payload.readyAt,
                onTheWayAt: event.payload.onTheWayAt,
                deliveredAt: event.payload.deliveredAt,
                updatedAt: event.payload.updatedAt,
              }),
            }),
          }),
        ),
      ),
    );
  }
}
