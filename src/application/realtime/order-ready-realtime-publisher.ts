import type { OrderReady } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { RealtimeDomainEvent } from "./realtime-event";

/** Adapts committed Ready transitions to the shared kitchen-status realtime API. */
export class OrderReadyRealtimePublisher implements DomainEventPublisher<OrderReady> {
  constructor(
    private readonly publisher: DomainEventPublisher<RealtimeDomainEvent>,
  ) {}

  async publish(events: readonly OrderReady[]): Promise<void> {
    await this.publisher.publish(
      Object.freeze(
        events.map((event) =>
          Object.freeze({
            type: "kitchen.status.updated" as const,
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
                markedReadyById: event.payload.markedReadyById,
                readyAt: event.payload.readyAt,
                updatedAt: event.payload.updatedAt,
              }),
            }),
          }),
        ),
      ),
    );
  }
}
