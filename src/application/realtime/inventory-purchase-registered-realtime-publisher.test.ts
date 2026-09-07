import { describe, expect, it, vi } from "vitest";

import type { InventoryPurchaseRegistered } from "../../domain";
import { InventoryPurchaseRegisteredRealtimePublisher } from "./inventory-purchase-registered-realtime-publisher";

describe("InventoryPurchaseRegisteredRealtimePublisher", () => {
  it("publishes the inventory update without private purchase details", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const publisher = new InventoryPurchaseRegisteredRealtimePublisher({
      publish,
    });
    const event: InventoryPurchaseRegistered = {
      type: "inventory.purchase.registered",
      occurredAt: "2026-09-06T10:00:00.000Z",
      payload: {
        purchaseId: "51000000-0000-4000-8000-000000000001",
        restaurantId: "30000000-0000-4000-8000-000000000001",
        operatingExpenseId: "52000000-0000-4000-8000-000000000001",
        totalAmount: "12.35",
        recordedAt: "2026-09-06T10:00:00.000Z",
        lines: [
          {
            inventoryItemId: "53000000-0000-4000-8000-000000000001",
            inventoryMovementId: "54000000-0000-4000-8000-000000000001",
            quantity: "2.500",
            unitOfMeasure: "kg",
            unitPrice: "4.94",
            lineTotal: "12.35",
          },
        ],
      },
    };
    await publisher.publish([event]);
    expect(publish).toHaveBeenCalledWith([
      {
        type: "inventory.updated",
        occurredAt: event.occurredAt,
        payload: {
          restaurantId: event.payload.restaurantId,
          entityId: event.payload.purchaseId,
          entityType: "inventory_purchase",
          data: {
            operatingExpenseId: event.payload.operatingExpenseId,
            totalAmount: "12.35",
            recordedAt: event.payload.recordedAt,
            inventoryItemIds: [event.payload.lines[0]!.inventoryItemId],
            inventoryMovementIds: [event.payload.lines[0]!.inventoryMovementId],
          },
        },
      },
    ]);
    expect(JSON.stringify(vi.mocked(publish).mock.calls)).not.toMatch(
      /supplier|reference|comments|unitPrice/i,
    );
  });
});
