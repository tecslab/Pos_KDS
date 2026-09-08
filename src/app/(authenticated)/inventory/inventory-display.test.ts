import { describe, expect, it, vi } from "vitest";

import type { RealtimeSubscriber } from "@/application";

import {
  InventoryRealtimeController,
  parseInventoryViewsPayload,
} from "./inventory-display";

const restaurantId = "30000000-0000-4000-8000-000000000001";
const itemId = "31000000-0000-4000-8000-000000000001";
const movementId = "32000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000001";

function views() {
  return {
    balances: [
      {
        restaurantId,
        restaurantName: "Centro",
        inventoryItemId: itemId,
        inventoryItemName: "Tomate",
        inventoryItemType: "INGREDIENT",
        unitOfMeasure: "kg",
        minimumStockLevel: "2.000",
        currentBalance: "1.000",
        isBelowMinimum: true,
      },
    ],
    movements: [
      {
        id: movementId,
        restaurantId,
        restaurantName: "Centro",
        inventoryItemId: itemId,
        inventoryItemName: "Tomate",
        type: "STOCK_IN",
        quantityDelta: "1.000",
        unitOfMeasure: "kg",
        recordedBy: { id: userId, displayName: "Ana" },
        recordedAt: "2026-09-07T10:00:00.000Z",
        businessOrigin: {
          type: "PURCHASE",
          id: "33000000-0000-4000-8000-000000000001",
        },
        comments: null,
        reversedMovementId: null,
      },
    ],
    activeAlerts: [
      {
        id: "34000000-0000-4000-8000-000000000001",
        restaurantId,
        restaurantName: "Centro",
        inventoryItemId: itemId,
        inventoryItemName: "Tomate",
        unitOfMeasure: "kg",
        threshold: "2.000",
        observedBalance: "1.000",
        openedAt: "2026-09-07T10:00:00.000Z",
      },
    ],
  };
}

describe("inventory display payload", () => {
  it("accepts complete persisted traceability but rejects malformed realtime refresh data", () => {
    expect(parseInventoryViewsPayload(views())).toMatchObject({
      balances: [{ inventoryItemName: "Tomate", currentBalance: "1.000" }],
      movements: [
        {
          businessOrigin: { type: "PURCHASE" },
          recordedBy: { displayName: "Ana" },
        },
      ],
    });
    expect(
      parseInventoryViewsPayload({
        ...views(),
        movements: [
          {
            ...views().movements[0],
            businessOrigin: { type: "PURCHASE", id: "not-an-id" },
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("InventoryRealtimeController", () => {
  it("refetches persisted data for both inventory event types and cleans up subscriptions", async () => {
    let onMessage:
      | ((
          message: Parameters<
            NonNullable<
              Parameters<RealtimeSubscriber["subscribe"]>[0]["onMessage"]
            >
          >[0],
        ) => void)
      | undefined;
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const subscriber: RealtimeSubscriber = {
      subscribe: vi.fn(async (request) => {
        onMessage = request.onMessage;
        return { unsubscribe };
      }),
    };
    const refreshInventory = vi.fn().mockResolvedValue(undefined);
    const controller = new InventoryRealtimeController({
      subscriber,
      restaurantIds: [restaurantId],
      refreshInventory,
      onStatus: vi.fn(),
    });

    await controller.start();
    expect(refreshInventory).toHaveBeenCalledTimes(1);
    onMessage?.({ eventName: "inventory.updated", envelope: {} as never });
    onMessage?.({ eventName: "inventory.alert", envelope: {} as never });
    await vi.waitFor(() => expect(refreshInventory).toHaveBeenCalledTimes(2));
    await controller.stop();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("recovers a terminal subscription failure through authorized polling", async () => {
    let terminal: (() => void) | undefined;
    let polling: (() => void) | undefined;
    const status = vi.fn();
    const controller = new InventoryRealtimeController({
      subscriber: {
        subscribe: vi.fn(async (request) => {
          terminal = () =>
            request.onTerminalFailure?.({
              code: "REALTIME_SUBSCRIPTION_TERMINATED",
            });
          return { unsubscribe: vi.fn().mockResolvedValue(undefined) };
        }),
      },
      restaurantIds: [restaurantId],
      refreshInventory: vi.fn().mockResolvedValue(undefined),
      onStatus: status,
      setInterval: (callback) => {
        polling = callback;
        return 1 as never;
      },
      clearInterval: vi.fn(),
    });
    await controller.start();
    terminal?.();
    polling?.();
    await vi.waitFor(() => expect(status).toHaveBeenCalledWith("degraded"));
    await controller.stop();
  });
});
