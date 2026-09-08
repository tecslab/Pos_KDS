import { describe, expect, it, vi } from "vitest";

import type { InventoryAdjustmentWasteRegistered } from "../../domain";
import { InventoryAdjustmentWasteRegisteredRealtimePublisher } from "./inventory-adjustment-waste-registered-realtime-publisher";

describe("InventoryAdjustmentWasteRegisteredRealtimePublisher", () => {
  it("publishes a sanitized inventory update", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const publisher = new InventoryAdjustmentWasteRegisteredRealtimePublisher({
      publish,
    });
    const event: InventoryAdjustmentWasteRegistered = {
      type: "inventory.waste.registered",
      occurredAt: "2026-09-07T10:00:00.000Z",
      payload: {
        originId: "60000000-0000-4000-8000-000000000004",
        inventoryMovementId: "60000000-0000-4000-8000-000000000005",
        restaurantId: "60000000-0000-4000-8000-000000000002",
        inventoryItemId: "60000000-0000-4000-8000-000000000003",
        quantityDelta: "-1.250",
        unitOfMeasure: "kg",
        recordedAt: "2026-09-07T10:00:00.000Z",
        previousBalance: "5.000",
        newBalance: "3.750",
      },
    };
    await publisher.publish([event]);
    expect(publish).toHaveBeenCalledWith([
      {
        type: "inventory.updated",
        occurredAt: event.occurredAt,
        payload: {
          restaurantId: event.payload.restaurantId,
          entityId: event.payload.originId,
          entityType: "inventory_waste_record",
          data: {
            inventoryItemId: event.payload.inventoryItemId,
            inventoryMovementId: event.payload.inventoryMovementId,
            quantityDelta: "-1.250",
            unitOfMeasure: "kg",
            previousBalance: "5.000",
            newBalance: "3.750",
            recordedAt: event.payload.recordedAt,
          },
        },
      },
    ]);
    expect(JSON.stringify(vi.mocked(publish).mock.calls)).not.toMatch(
      /reason|sourceIp/i,
    );
  });
});
