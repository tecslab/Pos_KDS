import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  InventoryPurchaseContext,
  InventoryPurchaseContextReader,
  InventoryPurchaseExpenseCategory,
  InventoryPurchaseItem,
  InventoryPurchaseRestaurant,
} from "../../application";

export class SupabaseInventoryPurchaseContextReader implements InventoryPurchaseContextReader {
  constructor(private readonly client: SupabaseClient) {}

  async read(): Promise<InventoryPurchaseContext> {
    try {
      const [restaurants, items, expenseCategories] = await Promise.all([
        this.client
          .from("restaurants")
          .select("id, name")
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("inventory_items")
          .select("id, restaurant_id, name, unit_of_measure")
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("expense_categories")
          .select("id, restaurant_id, code, name")
          .eq("is_active", true)
          .is("deleted_at", null),
      ]);
      if (
        [restaurants, items, expenseCategories].some(
          (response) =>
            response.error !== null || !Array.isArray(response.data),
        )
      ) {
        throw new Error();
      }

      const restaurantList = (restaurants.data as unknown[])
        .map(mapRestaurant)
        .sort((left, right) => left.name.localeCompare(right.name, "es"));
      const restaurantIds = new Set(restaurantList.map(({ id }) => id));
      const itemList = (items.data as unknown[])
        .map(mapItem)
        .filter((item) => restaurantIds.has(item.restaurantId))
        .sort(compareByRestaurantThenName);
      const categoryList = (expenseCategories.data as unknown[])
        .map(mapExpenseCategory)
        .filter((category) => restaurantIds.has(category.restaurantId))
        .sort(compareByRestaurantThenName);

      return Object.freeze({
        restaurants: Object.freeze(restaurantList),
        items: Object.freeze(itemList),
        expenseCategories: Object.freeze(categoryList),
      });
    } catch {
      throw new Error("Inventory purchase context could not be read.");
    }
  }
}

function mapRestaurant(value: unknown): InventoryPurchaseRestaurant {
  if (!isRecord(value) || !isUuid(value.id) || !isNonblank(value.name)) {
    throw new Error();
  }
  return Object.freeze({ id: value.id, name: value.name });
}

function mapItem(value: unknown): InventoryPurchaseItem {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.restaurant_id) ||
    !isNonblank(value.name) ||
    !isNonblank(value.unit_of_measure)
  ) {
    throw new Error();
  }
  return Object.freeze({
    id: value.id,
    restaurantId: value.restaurant_id,
    name: value.name,
    unitOfMeasure: value.unit_of_measure,
  });
}

function mapExpenseCategory(value: unknown): InventoryPurchaseExpenseCategory {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.restaurant_id) ||
    !isNonblank(value.code) ||
    !isNonblank(value.name)
  ) {
    throw new Error();
  }
  return Object.freeze({
    id: value.id,
    restaurantId: value.restaurant_id,
    code: value.code,
    name: value.name,
  });
}

function compareByRestaurantThenName(
  left: InventoryPurchaseItem | InventoryPurchaseExpenseCategory,
  right: InventoryPurchaseItem | InventoryPurchaseExpenseCategory,
) {
  return (
    left.restaurantId.localeCompare(right.restaurantId) ||
    left.name.localeCompare(right.name, "es") ||
    left.id.localeCompare(right.id)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
