import { describe, expect, it, vi } from "vitest";

import type { InventoryAlertChanged } from "../../domain";
import { InventoryAlertChangedRealtimePublisher } from "./inventory-alert-changed-realtime-publisher";

describe("InventoryAlertChangedRealtimePublisher", () => {
  it("maps a committed transition to a tenant-scoped sanitized alert event", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const publisher = new InventoryAlertChangedRealtimePublisher({ publish });
    const event: InventoryAlertChanged = {
      type: "inventory.alert.changed",
      occurredAt: "2026-09-07T10:00:00.000Z",
      payload: {
        restaurantId: "30000000-0000-4000-8000-000000000001",
        inventoryAlertId: "61000000-0000-4000-8000-000000000001",
        inventoryMovementId: "61000000-0000-4000-8000-000000000002",
        inventoryItemId: "61000000-0000-4000-8000-000000000003",
        status: "ACTIVE",
        threshold: "5.000",
        observedBalance: "4.500",
      },
    };

    await publisher.publish([event]);

    expect(publish).toHaveBeenCalledWith([
      {
        type: "inventory.alert",
        occurredAt: event.occurredAt,
        payload: {
          restaurantId: event.payload.restaurantId,
          entityId: event.payload.inventoryAlertId,
          entityType: "inventory_alert",
          data: {
            inventoryItemId: event.payload.inventoryItemId,
            inventoryMovementId: event.payload.inventoryMovementId,
            status: "ACTIVE",
            threshold: "5.000",
            observedBalance: "4.500",
          },
        },
      },
    ]);
    expect(JSON.stringify(publish.mock.calls)).not.toContain("reason");
    expect(JSON.stringify(publish.mock.calls)).not.toContain("sourceIp");
  });
});
