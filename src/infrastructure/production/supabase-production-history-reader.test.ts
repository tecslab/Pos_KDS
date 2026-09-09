import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  ProductionHistoryReadError,
  SupabaseProductionHistoryReader,
} from "./supabase-production-history-reader";

const restaurantId = "20000000-0000-4000-8000-000000000001";
const batchId = "30000000-0000-4000-8000-000000000001";
const recipeVersionId = "40000000-0000-4000-8000-000000000001";
const recipeId = "50000000-0000-4000-8000-000000000001";
const userId = "60000000-0000-4000-8000-000000000001";
const productId = "70000000-0000-4000-8000-000000000001";

function query(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  return builder;
}

function client(
  batchResult: unknown,
  restaurantResult: unknown,
  productResult = {
    data: [{ id: productId, restaurant_id: restaurantId }],
    error: null,
  },
  productVersionResult = {
    data: [
      {
        restaurant_id: restaurantId,
        product_id: productId,
        version_number: 2,
        name: "Salsa preparada",
      },
    ],
    error: null,
  },
) {
  const batches = query(batchResult);
  const restaurants = query(restaurantResult);
  const products = query(productResult);
  const productVersions = query(productVersionResult);
  return {
    client: {
      from: vi.fn((table: string) => {
        if (table === "production_batches") return batches;
        if (table === "restaurants") return restaurants;
        if (table === "products") return products;
        return productVersions;
      }),
    } as unknown as SupabaseClient,
    batches,
  };
}

function batch(overrides: Record<string, unknown> = {}) {
  return {
    id: batchId,
    restaurant_id: restaurantId,
    recipe_version_id: recipeVersionId,
    status: "COMPLETED",
    produced_quantity: "5",
    unit_of_measure: "litro",
    completed_by_id: userId,
    completed_at: "2026-09-08T10:00:00.000Z",
    notes: "Mise en place",
    recipe_version: {
      id: recipeVersionId,
      recipe_id: recipeId,
      version_number: 3,
      recipe: {
        id: recipeId,
        product_id: productId,
        name: "Salsa de la casa",
      },
    },
    completed_by: { id: userId, display_name: "Ana" },
    ...overrides,
  };
}

describe("SupabaseProductionHistoryReader", () => {
  it("reads only completed batches with their immutable historical references", async () => {
    const { client: supabase, batches } = client(
      { data: [batch()], error: null },
      { data: [{ id: restaurantId, name: "Centro" }], error: null },
    );

    await expect(
      new SupabaseProductionHistoryReader(supabase).read(),
    ).resolves.toEqual([
      expect.objectContaining({
        batchId,
        recipeVersionId,
        recipeVersionNumber: 3,
        productId,
        productName: "Salsa preparada",
        producedQuantity: "5.000",
        completedBy: { id: userId, displayName: "Ana" },
        notes: "Mise en place",
      }),
    ]);
    expect(batches.eq).toHaveBeenCalledWith("status", "COMPLETED");
    expect(batches.order).toHaveBeenCalledWith("completed_at", {
      ascending: false,
    });
  });

  it("fails closed when a completed record lacks its immutable completion data", async () => {
    const { client: supabase } = client(
      { data: [batch({ completed_at: null })], error: null },
      { data: [{ id: restaurantId, name: "Centro" }], error: null },
    );

    await expect(
      new SupabaseProductionHistoryReader(supabase).read(),
    ).rejects.toBeInstanceOf(ProductionHistoryReadError);
  });
});
