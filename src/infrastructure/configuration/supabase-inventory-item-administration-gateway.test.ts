import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";

import type { InventoryItem } from "../../application";
import { SupabaseInventoryItemAdministrationGateway } from "./supabase-inventory-item-administration-gateway";

const restaurantId = "30000000-0000-4000-8000-000000000001";
const itemId = "52000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000001";
const item: InventoryItem = Object.freeze({
  id: itemId,
  restaurantId,
  restaurantName: "Carnales",
  name: "Cebolla",
  type: "RAW_INGREDIENT",
  unitOfMeasure: "kg",
  minimumStockLevel: 2.5,
  currentStock: 8,
  isActive: true,
  identityLocked: true,
});

it("lists items with movement-derived stock and identity lock state", async () => {
  const from = vi.fn((table: string) => {
    if (table === "restaurants")
      return chain([{ id: restaurantId, name: "Carnales" }], true);
    if (table === "inventory_items")
      return chain([
        {
          id: itemId,
          restaurant_id: restaurantId,
          name: "Cebolla",
          type: "RAW_INGREDIENT",
          unit_of_measure: "kg",
          minimum_stock_level: "2.500",
          is_active: true,
        },
      ]);
    if (table === "inventory_balances")
      return chain([
        {
          restaurant_id: restaurantId,
          inventory_item_id: itemId,
          current_balance: "8.000",
        },
      ]);
    return chain([
      { restaurant_id: restaurantId, inventory_item_id: itemId },
      { restaurant_id: restaurantId, inventory_item_id: itemId },
    ]);
  });
  const gateway = new SupabaseInventoryItemAdministrationGateway({
    from,
  } as unknown as SupabaseClient);

  await expect(gateway.list()).resolves.toMatchObject({
    items: [
      {
        name: "Cebolla",
        minimumStockLevel: 2.5,
        currentStock: 8,
        identityLocked: true,
      },
    ],
  });
  expect(from).toHaveBeenCalledWith("inventory_balances");
  expect(from).toHaveBeenCalledWith("inventory_movements");
});

it("stages centralized audit and calls only the atomic inventory RPC", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [{}], error: null });
  const gateway = new SupabaseInventoryItemAdministrationGateway({
    rpc,
  } as unknown as SupabaseClient);
  await gateway.append({
    actorId,
    occurredAt: "2026-08-24T15:00:00.000Z",
    action: "inventory_item.updated",
    entityType: "inventory_item",
    entityId: itemId,
    previousValues: {},
    newValues: {},
    sourceIp: null,
  });

  await expect(gateway.save(actorId, item)).resolves.toEqual(item);
  expect(rpc).toHaveBeenCalledWith("save_inventory_item", {
    actor_user_id: actorId,
    target_restaurant_id: restaurantId,
    target_inventory_item_id: itemId,
    inventory_item_name: "Cebolla",
    inventory_item_type: "RAW_INGREDIENT",
    inventory_item_unit: "kg",
    inventory_item_minimum_stock: 2.5,
    inventory_item_is_active: true,
    audit_event_text: expect.stringContaining('"entityType":"inventory_item"'),
  });
});

it("fails closed without a staged audit event", async () => {
  const rpc = vi.fn();
  const gateway = new SupabaseInventoryItemAdministrationGateway({
    rpc,
  } as unknown as SupabaseClient);
  await expect(gateway.save(actorId, item)).rejects.toThrow(
    "Inventory item persistence failed",
  );
  expect(rpc).not.toHaveBeenCalled();
});

function chain(data: unknown[], withRestaurantFilters = false) {
  if (withRestaurantFilters)
    return {
      select: () => ({
        eq: () => ({ is: () => Promise.resolve({ data, error: null }) }),
      }),
    };
  return {
    select: () => ({
      is: () => Promise.resolve({ data, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(resolve),
    }),
  };
}
