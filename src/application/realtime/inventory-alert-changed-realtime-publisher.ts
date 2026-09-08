import type { InventoryAlertChanged } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { RealtimeDomainEvent } from "./realtime-event";

/** Publishes only the non-sensitive state snapshot produced by the committed movement. */
export class InventoryAlertChangedRealtimePublisher implements DomainEventPublisher<InventoryAlertChanged> {
  constructor(
    private readonly publisher: DomainEventPublisher<RealtimeDomainEvent>,
  ) {}

  async publish(events: readonly InventoryAlertChanged[]): Promise<void> {
    await this.publisher.publish(
      Object.freeze(
        events.map((event) =>
          Object.freeze({
            type: "inventory.alert" as const,
            occurredAt: event.occurredAt,
            payload: Object.freeze({
              restaurantId: event.payload.restaurantId,
              entityId: event.payload.inventoryAlertId,
              entityType: "inventory_alert",
              data: Object.freeze({
                inventoryItemId: event.payload.inventoryItemId,
                inventoryMovementId: event.payload.inventoryMovementId,
                status: event.payload.status,
                threshold: event.payload.threshold,
                observedBalance: event.payload.observedBalance,
              }),
            }),
          }),
        ),
      ),
    );
  }
}
