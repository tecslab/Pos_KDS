import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuditEventAppender,
  AuditEventRecord,
  InventoryItem,
  InventoryItemAdministrationGateway,
  InventoryItemAdministrationView,
  InventoryItemType,
} from "../../application";

export class SupabaseInventoryItemAdministrationGateway
  implements InventoryItemAdministrationGateway, AuditEventAppender
{
  private pendingAudit: AuditEventRecord | null = null;

  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<InventoryItemAdministrationView> {
    try {
      const [restaurants, items, balances, movements] = await Promise.all([
        this.client
          .from("restaurants")
          .select("id, name")
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("inventory_items")
          .select(
            "id, restaurant_id, name, type, unit_of_measure, minimum_stock_level, is_active",
          )
          .is("deleted_at", null),
        this.client
          .from("inventory_balances")
          .select("restaurant_id, inventory_item_id, current_balance"),
        this.client
          .from("inventory_movements")
          .select("restaurant_id, inventory_item_id"),
      ]);
      const responses = [restaurants, items, balances, movements];
      if (
        responses.some(
          (response) => response.error || !Array.isArray(response.data),
        )
      )
        throw new Error();

      const restaurantList = (restaurants.data as unknown[])
        .map(mapRestaurant)
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      const names = new Map(
        restaurantList.map((restaurant) => [restaurant.id, restaurant.name]),
      );
      const balanceByItem = new Map(
        (balances.data as unknown[]).map(mapBalance),
      );
      const lockedItems = new Set(
        (movements.data as unknown[]).map(mapMovementIdentity),
      );
      const itemList = (items.data as unknown[])
        .map((row) => mapItem(row, names, balanceByItem, lockedItems))
        .sort(
          (a, b) =>
            a.restaurantName.localeCompare(b.restaurantName, "es") ||
            a.name.localeCompare(b.name, "es"),
        );

      return Object.freeze({
        restaurants: Object.freeze(restaurantList),
        items: Object.freeze(itemList),
      });
    } catch {
      throw new Error("Inventory item persistence failed.");
    }
  }

  async save(actorId: string, item: InventoryItem): Promise<InventoryItem> {
    try {
      const audit = this.pendingAudit;
      if (!audit || audit.actorId !== actorId || audit.entityId !== item.id)
        throw new Error();

      const { data, error } = await this.client.rpc("save_inventory_item", {
        actor_user_id: actorId,
        target_restaurant_id: item.restaurantId,
        target_inventory_item_id: item.id,
        inventory_item_name: item.name,
        inventory_item_type: item.type,
        inventory_item_unit: item.unitOfMeasure,
        inventory_item_minimum_stock: item.minimumStockLevel,
        inventory_item_is_active: item.isActive,
        audit_event_text: JSON.stringify(audit),
      });
      if (error || !Array.isArray(data) || data.length !== 1) throw new Error();
      return Object.freeze(item);
    } catch {
      throw new Error("Inventory item persistence failed.");
    } finally {
      this.pendingAudit = null;
    }
  }

  async append(event: AuditEventRecord) {
    if (this.pendingAudit) throw new Error("Audit transaction is busy.");
    this.pendingAudit = event;
  }
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

function mapBalance(row: unknown): readonly [string, number] {
  if (
    !isRecord(row) ||
    typeof row.restaurant_id !== "string" ||
    typeof row.inventory_item_id !== "string"
  )
    throw new Error();
  return [
    scopedId(row.restaurant_id, row.inventory_item_id),
    decimal(row.current_balance),
  ];
}

function mapMovementIdentity(row: unknown) {
  if (
    !isRecord(row) ||
    typeof row.restaurant_id !== "string" ||
    typeof row.inventory_item_id !== "string"
  )
    throw new Error();
  return scopedId(row.restaurant_id, row.inventory_item_id);
}

function mapItem(
  row: unknown,
  restaurantNames: ReadonlyMap<string, string>,
  balances: ReadonlyMap<string, number>,
  lockedItems: ReadonlySet<string>,
): InventoryItem {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.name !== "string" ||
    !isInventoryItemType(row.type) ||
    typeof row.unit_of_measure !== "string" ||
    typeof row.is_active !== "boolean" ||
    typeof restaurantNames.get(row.restaurant_id) !== "string"
  )
    throw new Error();
  const key = scopedId(row.restaurant_id, row.id);
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    restaurantName: restaurantNames.get(row.restaurant_id) as string,
    name: row.name,
    type: row.type,
    unitOfMeasure: row.unit_of_measure,
    minimumStockLevel: decimal(row.minimum_stock_level),
    currentStock: balances.get(key) ?? 0,
    isActive: row.is_active,
    identityLocked: lockedItems.has(key),
  });
}

function decimal(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error();
  return parsed;
}

function isInventoryItemType(value: unknown): value is InventoryItemType {
  return ["RAW_INGREDIENT", "PRODUCED_ITEM", "RESALE_ITEM"].includes(
    value as string,
  );
}

function scopedId(restaurantId: string, itemId: string) {
  return `${restaurantId}:${itemId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
