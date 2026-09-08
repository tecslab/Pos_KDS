import type { InventoryAdjustmentWasteRegistered } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { RealtimeDomainEvent } from "./realtime-event";

/** Publishes committed balance changes without the auditable reason or source IP. */
export class InventoryAdjustmentWasteRegisteredRealtimePublisher implements DomainEventPublisher<InventoryAdjustmentWasteRegistered> {
  constructor(
    private readonly publisher: DomainEventPublisher<RealtimeDomainEvent>,
  ) {}

  async publish(
    events: readonly InventoryAdjustmentWasteRegistered[],
  ): Promise<void> {
    await this.publisher.publish(
      Object.freeze(
        events.map((event) =>
          Object.freeze({
            type: "inventory.updated" as const,
            occurredAt: event.occurredAt,
            payload: Object.freeze({
              restaurantId: event.payload.restaurantId,
              entityId: event.payload.originId,
              entityType:
                event.type === "inventory.adjustment.registered"
                  ? "inventory_adjustment"
                  : "inventory_waste_record",
              data: Object.freeze({
                inventoryItemId: event.payload.inventoryItemId,
                inventoryMovementId: event.payload.inventoryMovementId,
                quantityDelta: event.payload.quantityDelta,
                unitOfMeasure: event.payload.unitOfMeasure,
                previousBalance: event.payload.previousBalance,
                newBalance: event.payload.newBalance,
                recordedAt: event.payload.recordedAt,
              }),
            }),
          }),
        ),
      ),
    );
  }
}
