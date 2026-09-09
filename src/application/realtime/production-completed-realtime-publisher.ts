import type { ProductionCompleted } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { RealtimeDomainEvent } from "./realtime-event";

/** Publishes committed production and inventory identifiers without notes or actor data. */
export class ProductionCompletedRealtimePublisher implements DomainEventPublisher<ProductionCompleted> {
  constructor(
    private readonly publisher: DomainEventPublisher<RealtimeDomainEvent>,
  ) {}

  async publish(events: readonly ProductionCompleted[]): Promise<void> {
    await this.publisher.publish(
      Object.freeze(
        events.map((event) =>
          Object.freeze({
            type: "production.completed" as const,
            occurredAt: event.occurredAt,
            payload: Object.freeze({
              restaurantId: event.payload.restaurantId,
              entityId: event.payload.batchId,
              entityType: "production_batch",
              data: Object.freeze({
                recipeVersionId: event.payload.recipeVersionId,
                producedQuantity: event.payload.producedQuantity,
                unitOfMeasure: event.payload.unitOfMeasure,
                completedAt: event.payload.completedAt,
                outputInventoryItemId: event.payload.output.inventoryItemId,
                outputInventoryMovementId:
                  event.payload.output.inventoryMovementId,
                ingredientInventoryItemIds: Object.freeze(
                  event.payload.ingredients.map(
                    (ingredient) => ingredient.inventoryItemId,
                  ),
                ),
                ingredientInventoryMovementIds: Object.freeze(
                  event.payload.ingredients.map(
                    (ingredient) => ingredient.inventoryMovementId,
                  ),
                ),
              }),
            }),
          }),
        ),
      ),
    );
  }
}
