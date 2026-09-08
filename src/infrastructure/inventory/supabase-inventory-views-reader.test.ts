import { describe, expect, it, vi } from "vitest";

import { SupabaseInventoryViewsReader } from "./supabase-inventory-views-reader";

const restaurantId = "30000000-0000-4000-8000-000000000001";
const itemId = "31000000-0000-4000-8000-000000000001";
const movementId = "32000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000001";

function clientWith(rows: Readonly<Record<string, unknown[]>>) {
  const from = vi.fn((table: string) => {
    const result = { data: rows[table] ?? [], error: null };
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      order: vi.fn(() => query),
      then: <T>(resolve: (value: typeof result) => T) =>
        Promise.resolve(result).then(resolve),
    };
    return query;
  });
  return { client: { from } as never, from };
}

function rows() {
  return {
    inventory_items: [
      {
        id: itemId,
        restaurant_id: restaurantId,
        name: "Tomate",
        type: "INGREDIENT",
        unit_of_measure: "kg",
        minimum_stock_level: "2",
        restaurant: { id: restaurantId, name: "Centro" },
      },
    ],
    inventory_balances: [
      {
        restaurant_id: restaurantId,
        inventory_item_id: itemId,
        unit_of_measure: "kg",
        current_balance: "1.5",
      },
    ],
    inventory_movements: [
      {
        id: movementId,
        restaurant_id: restaurantId,
        inventory_item_id: itemId,
        type: "STOCK_IN",
        quantity_delta: "1.5",
        unit_of_measure: "kg",
        recorded_by_id: userId,
        recorded_at: "2026-09-07T10:00:00.000Z",
        business_origin_type: "PURCHASE",
        business_origin_id: "33000000-0000-4000-8000-000000000001",
        comments: "Proveedor",
        reversed_movement_id: null,
        recorded_by: { id: userId, display_name: "Ana" },
      },
    ],
    inventory_alerts: [
      {
        id: "34000000-0000-4000-8000-000000000001",
        restaurant_id: restaurantId,
        inventory_item_id: itemId,
        status: "ACTIVE",
        threshold: "2",
        observed_balance: "1.5",
        opened_at: "2026-09-07T10:00:00.000Z",
        resolved_at: null,
      },
    ],
  };
}

describe("SupabaseInventoryViewsReader", () => {
  it("maps movement-derived balances, immutable traceability, and active alerts from tenant-consistent persisted rows", async () => {
    const { client, from } = clientWith(rows());

    await expect(
      new SupabaseInventoryViewsReader(client).read(),
    ).resolves.toEqual({
      balances: [
        {
          restaurantId,
          restaurantName: "Centro",
          inventoryItemId: itemId,
          inventoryItemName: "Tomate",
          inventoryItemType: "INGREDIENT",
          unitOfMeasure: "kg",
          minimumStockLevel: "2.000",
          currentBalance: "1.500",
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
          quantityDelta: "1.500",
          unitOfMeasure: "kg",
          recordedBy: { id: userId, displayName: "Ana" },
          recordedAt: "2026-09-07T10:00:00.000Z",
          businessOrigin: {
            type: "PURCHASE",
            id: "33000000-0000-4000-8000-000000000001",
          },
          comments: "Proveedor",
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
          observedBalance: "1.500",
          openedAt: "2026-09-07T10:00:00.000Z",
        },
      ],
    });
    expect(from).toHaveBeenCalledWith("inventory_balances");
    expect(from).toHaveBeenCalledWith("inventory_movements");
    expect(from).toHaveBeenCalledWith("inventory_alerts");
  });

  it("fails closed for a cross-tenant balance or incomplete immutable traceability", async () => {
    const invalid = rows();
    invalid.inventory_balances = [
      {
        ...invalid.inventory_balances[0],
        restaurant_id: "30000000-0000-4000-8000-000000000099",
      },
    ];
    const { client } = clientWith(invalid);

    await expect(
      new SupabaseInventoryViewsReader(client).read(),
    ).rejects.toThrow("Inventory views could not be read.");
  });
});
