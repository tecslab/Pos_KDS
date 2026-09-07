import { describe, expect, it, vi } from "vitest";

import { SupabaseInventoryPurchaseContextReader } from "./supabase-inventory-purchase-context-reader";

const restaurantId = "30000000-0000-4000-8000-000000000001";
const orphanRestaurantId = "30000000-0000-4000-8000-000000000099";
const itemId = "31000000-0000-4000-8000-000000000001";
const categoryId = "32000000-0000-4000-8000-000000000001";

function clientWith(rows: Readonly<Record<string, unknown[]>>) {
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      is: vi.fn(async () => ({ data: rows[table] ?? [], error: null })),
    };
    return query;
  });
  return { client: { from } as never, from };
}

describe("SupabaseInventoryPurchaseContextReader", () => {
  it("reads active selectable records and omits records whose restaurant is no longer active", async () => {
    const { client, from } = clientWith({
      restaurants: [{ id: restaurantId, name: "Centro" }],
      inventory_items: [
        {
          id: itemId,
          restaurant_id: restaurantId,
          name: "Tomate",
          unit_of_measure: "kg",
        },
        {
          id: "31000000-0000-4000-8000-000000000002",
          restaurant_id: orphanRestaurantId,
          name: "No disponible",
          unit_of_measure: "kg",
        },
      ],
      expense_categories: [
        {
          id: categoryId,
          restaurant_id: restaurantId,
          code: "INGREDIENTS",
          name: "Ingredientes",
        },
      ],
    });

    await expect(
      new SupabaseInventoryPurchaseContextReader(client).read(),
    ).resolves.toEqual({
      restaurants: [{ id: restaurantId, name: "Centro" }],
      items: [
        {
          id: itemId,
          restaurantId,
          name: "Tomate",
          unitOfMeasure: "kg",
        },
      ],
      expenseCategories: [
        {
          id: categoryId,
          restaurantId,
          code: "INGREDIENTS",
          name: "Ingredientes",
        },
      ],
    });

    expect(from).toHaveBeenCalledWith("restaurants");
    expect(from).toHaveBeenCalledWith("inventory_items");
    expect(from).toHaveBeenCalledWith("expense_categories");
  });

  it("fails closed when a selectable row is malformed", async () => {
    const { client } = clientWith({
      restaurants: [{ id: restaurantId, name: "Centro" }],
      inventory_items: [
        {
          id: itemId,
          restaurant_id: restaurantId,
          name: "Tomate",
          unit_of_measure: "",
        },
      ],
      expense_categories: [],
    });

    await expect(
      new SupabaseInventoryPurchaseContextReader(client).read(),
    ).rejects.toThrow("Inventory purchase context could not be read.");
  });
});
