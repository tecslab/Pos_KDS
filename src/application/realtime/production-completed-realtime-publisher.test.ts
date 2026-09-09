import { describe, expect, it, vi } from "vitest";

import type { ProductionCompleted } from "../../domain";
import { ProductionCompletedRealtimePublisher } from "./production-completed-realtime-publisher";

describe("ProductionCompletedRealtimePublisher", () => {
  it("publishes a sanitized production event for production and inventory subscribers", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const publisher = new ProductionCompletedRealtimePublisher({ publish });
    const event: ProductionCompleted = {
      type: "production.completed",
      occurredAt: "2026-09-08T10:00:00.000Z",
      payload: {
        batchId: "60000000-0000-4000-8000-000000000001",
        restaurantId: "20000000-0000-4000-8000-000000000001",
        recipeVersionId: "40000000-0000-4000-8000-000000000001",
        producedQuantity: "5.000",
        unitOfMeasure: "unit",
        completedAt: "2026-09-08T10:00:00.000Z",
        ingredients: [
          {
            inventoryItemId: "70000000-0000-4000-8000-000000000001",
            inventoryMovementId: "71000000-0000-4000-8000-000000000001",
            quantityConsumed: "2.500",
            unitOfMeasure: "kg",
            previousBalance: "10.000",
            newBalance: "7.500",
          },
        ],
        output: {
          inventoryItemId: "80000000-0000-4000-8000-000000000001",
          inventoryMovementId: "81000000-0000-4000-8000-000000000001",
          quantityProduced: "5.000",
          unitOfMeasure: "unit",
          previousBalance: "1.000",
          newBalance: "6.000",
        },
      },
    };

    await publisher.publish([event]);

    expect(publish).toHaveBeenCalledWith([
      {
        type: "production.completed",
        occurredAt: event.occurredAt,
        payload: {
          restaurantId: event.payload.restaurantId,
          entityId: event.payload.batchId,
          entityType: "production_batch",
          data: {
            recipeVersionId: event.payload.recipeVersionId,
            producedQuantity: "5.000",
            unitOfMeasure: "unit",
            completedAt: event.payload.completedAt,
            outputInventoryItemId: event.payload.output.inventoryItemId,
            outputInventoryMovementId: event.payload.output.inventoryMovementId,
            ingredientInventoryItemIds: [
              event.payload.ingredients[0]!.inventoryItemId,
            ],
            ingredientInventoryMovementIds: [
              event.payload.ingredients[0]!.inventoryMovementId,
            ],
          },
        },
      },
    ]);
    expect(JSON.stringify(vi.mocked(publish).mock.calls)).not.toMatch(
      /notes|completedBy|previousBalance|newBalance/i,
    );
  });
});
