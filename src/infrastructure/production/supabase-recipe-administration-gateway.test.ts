import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";

import type { Recipe } from "../../application";
import { SupabaseRecipeAdministrationGateway } from "./supabase-recipe-administration-gateway";

const restaurantId = "30000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000001";
const recipe: Recipe = Object.freeze({
  id: "60000000-0000-4000-8000-000000000001",
  restaurantId,
  restaurantName: "Carnales",
  productId: "40000000-0000-4000-8000-000000000001",
  productName: "Salsa",
  outputInventoryItemId: "50000000-0000-4000-8000-000000000001",
  outputInventoryItemName: "Salsa preparada",
  name: "Salsa base",
  isActive: true,
  versionId: "61000000-0000-4000-8000-000000000002",
  versionNumber: 2,
  availableVersionNumbers: Object.freeze([1, 2]),
  producedQuantity: 3,
  producedUnit: "litro",
  ingredients: Object.freeze([
    {
      id: "62000000-0000-4000-8000-000000000002",
      inventoryItemId: "51000000-0000-4000-8000-000000000001",
      inventoryItemName: "Tomate",
      requiredQuantity: 2,
      unitOfMeasure: "kg",
    },
  ]),
});

it("maps restaurant-scoped latest versions and ingredient snapshots", async () => {
  const rows: Record<string, unknown[]> = {
    restaurants: [{ id: restaurantId, name: "Carnales" }],
    products: [
      { id: recipe.productId, restaurant_id: restaurantId, is_active: true },
    ],
    product_versions: [
      {
        id: "pv",
        restaurant_id: restaurantId,
        product_id: recipe.productId,
        version_number: 2,
        name: "Salsa",
      },
    ],
    inventory_items: [
      {
        id: recipe.outputInventoryItemId,
        restaurant_id: restaurantId,
        name: "Salsa preparada",
        type: "PRODUCED_ITEM",
        unit_of_measure: "litro",
        is_active: true,
      },
      {
        id: recipe.ingredients[0]!.inventoryItemId,
        restaurant_id: restaurantId,
        name: "Tomate",
        type: "RAW_INGREDIENT",
        unit_of_measure: "kg",
        is_active: true,
      },
    ],
    recipes: [
      {
        id: recipe.id,
        restaurant_id: restaurantId,
        product_id: recipe.productId,
        output_inventory_item_id: recipe.outputInventoryItemId,
        name: "Salsa base",
        is_active: true,
      },
    ],
    recipe_versions: [
      {
        id: "61000000-0000-4000-8000-000000000001",
        restaurant_id: restaurantId,
        recipe_id: recipe.id,
        version_number: 1,
        produced_quantity: "2.000",
        produced_unit: "litro",
      },
      {
        id: recipe.versionId,
        restaurant_id: restaurantId,
        recipe_id: recipe.id,
        version_number: 2,
        produced_quantity: "3.000",
        produced_unit: "litro",
      },
    ],
    recipe_ingredients: [
      {
        id: recipe.ingredients[0]!.id,
        restaurant_id: restaurantId,
        recipe_version_id: recipe.versionId,
        inventory_item_id: recipe.ingredients[0]!.inventoryItemId,
        required_quantity: "2.000",
        unit_of_measure: "kg",
      },
    ],
  };
  const from = vi.fn((table: string) => query(rows[table] ?? []));
  const gateway = new SupabaseRecipeAdministrationGateway({
    from,
  } as unknown as SupabaseClient);
  await expect(gateway.list()).resolves.toMatchObject({
    recipes: [
      {
        versionNumber: 2,
        availableVersionNumbers: [1, 2],
        ingredients: [{ inventoryItemName: "Tomate" }],
      },
    ],
  });
});

it("stages audit and calls only the atomic recipe RPC", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [{}], error: null });
  const gateway = new SupabaseRecipeAdministrationGateway({
    rpc,
  } as unknown as SupabaseClient);
  await gateway.append({
    actorId,
    occurredAt: "2026-08-24T18:00:00.000Z",
    action: "recipe.updated",
    entityType: "recipe",
    entityId: recipe.id,
    previousValues: {},
    newValues: {},
    sourceIp: null,
  });
  await expect(gateway.save(actorId, recipe)).resolves.toEqual(recipe);
  expect(rpc).toHaveBeenCalledWith(
    "save_recipe",
    expect.objectContaining({
      actor_user_id: actorId,
      target_recipe_id: recipe.id,
      target_recipe_version_id: recipe.versionId,
      expected_previous_version_number: 1,
      recipe_ingredients_text: expect.stringContaining('"unitOfMeasure":"kg"'),
      audit_event_text: expect.stringContaining('"entityType":"recipe"'),
    }),
  );
});

it("fails closed without a staged audit", async () => {
  const rpc = vi.fn();
  const gateway = new SupabaseRecipeAdministrationGateway({
    rpc,
  } as unknown as SupabaseClient);
  await expect(gateway.save(actorId, recipe)).rejects.toThrow(
    "Recipe persistence failed",
  );
  expect(rpc).not.toHaveBeenCalled();
});

function query(data: unknown[]) {
  const response = Promise.resolve({ data, error: null });
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    in: () => builder,
    then: response.then.bind(response),
  };
  return builder;
}
