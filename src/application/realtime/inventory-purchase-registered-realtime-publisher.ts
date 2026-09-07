import type { InventoryPurchaseRegistered } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { RealtimeDomainEvent } from "./realtime-event";

/** Publishes committed inventory changes without supplier, reference, or comments. */
export class InventoryPurchaseRegisteredRealtimePublisher implements DomainEventPublisher<InventoryPurchaseRegistered> {
  constructor(
    private readonly publisher: DomainEventPublisher<RealtimeDomainEvent>,
  ) {}

  async publish(events: readonly InventoryPurchaseRegistered[]): Promise<void> {
    await this.publisher.publish(
      Object.freeze(
        events.map((event) =>
          Object.freeze({
            type: "inventory.updated" as const,
            occurredAt: event.occurredAt,
            payload: Object.freeze({
              restaurantId: event.payload.restaurantId,
              entityId: event.payload.purchaseId,
              entityType: "inventory_purchase",
              data: Object.freeze({
                operatingExpenseId: event.payload.operatingExpenseId,
                totalAmount: event.payload.totalAmount,
                recordedAt: event.payload.recordedAt,
                inventoryItemIds: Object.freeze(
                  event.payload.lines.map((line) => line.inventoryItemId),
                ),
                inventoryMovementIds: Object.freeze(
                  event.payload.lines.map((line) => line.inventoryMovementId),
                ),
              }),
            }),
          }),
        ),
      ),
    );
  }
}
