import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuditEventAppender,
  AuditEventRecord,
  ProductCategory,
  ProductCategoryAdministrationGateway,
  ProductCategoryAdministrationView,
} from "../../application";

export class SupabaseProductCategoryAdministrationGateway
  implements ProductCategoryAdministrationGateway, AuditEventAppender
{
  private pendingAudit: AuditEventRecord | null = null;

  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<ProductCategoryAdministrationView> {
    try {
      const [restaurants, catalogs, categories] = await Promise.all([
        this.client
          .from("restaurants")
          .select("id, name")
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("product_catalogs")
          .select("restaurant_id")
          .is("deleted_at", null),
        this.client
          .from("product_categories")
          .select("id, restaurant_id, name, display_order, is_active")
          .is("deleted_at", null),
      ]);
      if (
        restaurants.error ||
        catalogs.error ||
        categories.error ||
        !Array.isArray(restaurants.data) ||
        !Array.isArray(catalogs.data) ||
        !Array.isArray(categories.data)
      )
        throw new Error();

      const catalogRestaurantIds = new Set(catalogs.data.map(mapCatalog));
      const restaurantList = restaurants.data
        .map(mapRestaurant)
        .filter((restaurant) => catalogRestaurantIds.has(restaurant.id))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      const names = new Map(
        restaurantList.map((restaurant) => [restaurant.id, restaurant.name]),
      );
      const categoryList = categories.data
        .map((row) => mapCategory(row, names))
        .sort(
          (a, b) =>
            a.restaurantName.localeCompare(b.restaurantName, "es") ||
            a.displayOrder - b.displayOrder ||
            a.name.localeCompare(b.name, "es"),
        );

      return Object.freeze({
        restaurants: Object.freeze(restaurantList),
        categories: Object.freeze(categoryList),
      });
    } catch {
      throw new Error("Product category persistence failed.");
    }
  }

  async save(
    actorId: string,
    category: ProductCategory,
  ): Promise<ProductCategory> {
    try {
      const audit = this.pendingAudit;
      if (!audit || audit.actorId !== actorId || audit.entityId !== category.id)
        throw new Error();

      const { data, error } = await this.client.rpc("save_product_category", {
        actor_user_id: actorId,
        target_restaurant_id: category.restaurantId,
        target_category_id: category.id,
        category_name: category.name,
        category_display_order: category.displayOrder,
        category_is_active: category.isActive,
        audit_event_text: JSON.stringify(audit),
      });
      if (error || !Array.isArray(data) || data.length !== 1) throw new Error();

      return Object.freeze(category);
    } catch {
      throw new Error("Product category persistence failed.");
    } finally {
      this.pendingAudit = null;
    }
  }

  async append(event: AuditEventRecord) {
    if (this.pendingAudit) throw new Error("Audit transaction is busy.");
    this.pendingAudit = event;
  }
}

function mapCatalog(row: unknown) {
  if (!isRecord(row) || typeof row.restaurant_id !== "string")
    throw new Error();
  return row.restaurant_id;
}

function mapRestaurant(row: unknown) {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.name !== "string"
  )
    throw new Error();
  return Object.freeze({ id: row.id, name: row.name });
}

function mapCategory(
  row: unknown,
  restaurantNames: ReadonlyMap<string, string>,
): ProductCategory {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.name !== "string" ||
    !Number.isInteger(row.display_order) ||
    typeof row.is_active !== "boolean" ||
    typeof restaurantNames.get(row.restaurant_id) !== "string"
  )
    throw new Error();

  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    restaurantName: restaurantNames.get(row.restaurant_id) as string,
    name: row.name,
    displayOrder: row.display_order as number,
    isActive: row.is_active,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
