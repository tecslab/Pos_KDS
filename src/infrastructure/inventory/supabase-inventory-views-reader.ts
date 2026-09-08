import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  InventoryBalanceView,
  InventoryLowStockAlertView,
  InventoryMovementView,
  InventoryViews,
  InventoryViewsReader,
} from "../../application";

const inventoryItemFields = `
  id, restaurant_id, name, type, unit_of_measure, minimum_stock_level,
  restaurant:restaurants!inventory_items_restaurant_id_fkey ( id, name )
`;
const inventoryMovementFields = `
  id, restaurant_id, inventory_item_id, type, quantity_delta, unit_of_measure,
  recorded_by_id, recorded_at, business_origin_type, business_origin_id,
  comments, reversed_movement_id,
  recorded_by:application_users!inventory_movements_recorded_by_id_fkey ( id, display_name )
`;
const inventoryAlertFields = `
  id, restaurant_id, inventory_item_id, status, threshold, observed_balance,
  opened_at, resolved_at
`;

export class InventoryViewsReadError extends Error {
  constructor() {
    super("Inventory views could not be read.");
    this.name = "InventoryViewsReadError";
  }
}

export class SupabaseInventoryViewsReader implements InventoryViewsReader {
  constructor(private readonly client: SupabaseClient) {}

  async read(): Promise<InventoryViews> {
    try {
      const [itemsResult, balancesResult, movementsResult, alertsResult] =
        await Promise.all([
          this.client.from("inventory_items").select(inventoryItemFields),
          this.client
            .from("inventory_balances")
            .select(
              "restaurant_id, inventory_item_id, unit_of_measure, current_balance",
            ),
          this.client
            .from("inventory_movements")
            .select(inventoryMovementFields)
            .order("recorded_at", { ascending: false })
            .order("id", { ascending: false }),
          this.client
            .from("inventory_alerts")
            .select(inventoryAlertFields)
            .eq("status", "ACTIVE")
            .is("resolved_at", null)
            .order("opened_at", { ascending: true })
            .order("id", { ascending: true }),
        ]);
      if (
        itemsResult.error !== null ||
        balancesResult.error !== null ||
        movementsResult.error !== null ||
        alertsResult.error !== null ||
        !Array.isArray(itemsResult.data) ||
        !Array.isArray(balancesResult.data) ||
        !Array.isArray(movementsResult.data) ||
        !Array.isArray(alertsResult.data)
      ) {
        throw new Error();
      }

      const itemByKey = new Map<string, InventoryItemRow>();
      for (const rawItem of itemsResult.data) {
        const item = mapItem(rawItem);
        const key = itemKey(item.restaurantId, item.id);
        if (itemByKey.has(key)) throw new Error();
        itemByKey.set(key, item);
      }

      const balanceByKey = new Map<string, string>();
      for (const rawBalance of balancesResult.data) {
        const balance = mapBalance(rawBalance, itemByKey);
        const key = itemKey(balance.restaurantId, balance.inventoryItemId);
        if (balanceByKey.has(key)) throw new Error();
        balanceByKey.set(key, balance.currentBalance);
      }

      const balances = [...itemByKey.values()]
        .map((item) => {
          const currentBalance =
            balanceByKey.get(itemKey(item.restaurantId, item.id)) ?? "0.000";
          return Object.freeze({
            restaurantId: item.restaurantId,
            restaurantName: item.restaurantName,
            inventoryItemId: item.id,
            inventoryItemName: item.name,
            inventoryItemType: item.type,
            unitOfMeasure: item.unitOfMeasure,
            minimumStockLevel: item.minimumStockLevel,
            currentBalance,
            isBelowMinimum:
              compareDecimal(currentBalance, item.minimumStockLevel) < 0,
          });
        })
        .sort(compareBalance);

      const movementIds = new Set<string>();
      const movements = movementsResult.data.map((rawMovement) => {
        const movement = mapMovement(rawMovement, itemByKey);
        if (movementIds.has(movement.id)) throw new Error();
        movementIds.add(movement.id);
        return movement;
      });

      const alertIds = new Set<string>();
      const activeAlerts = alertsResult.data.map((rawAlert) => {
        const alert = mapActiveAlert(rawAlert, itemByKey);
        if (alertIds.has(alert.id)) throw new Error();
        alertIds.add(alert.id);
        return alert;
      });

      return Object.freeze({
        balances: Object.freeze(balances),
        movements: Object.freeze(movements),
        activeAlerts: Object.freeze(activeAlerts),
      });
    } catch {
      throw new InventoryViewsReadError();
    }
  }
}

type InventoryItemRow = Readonly<{
  id: string;
  restaurantId: string;
  restaurantName: string;
  name: string;
  type: string;
  unitOfMeasure: string;
  minimumStockLevel: string;
}>;

function mapItem(value: unknown): InventoryItemRow {
  if (!isRecord(value)) throw new Error();
  const restaurant = singleRelation(value.restaurant);
  const minimumStockLevel = decimal(value.minimum_stock_level);
  if (
    !isUuid(value.id) ||
    !isUuid(value.restaurant_id) ||
    !isNonblank(value.name) ||
    !isNonblank(value.type) ||
    !isNonblank(value.unit_of_measure) ||
    !restaurant ||
    restaurant.id !== value.restaurant_id ||
    !isNonblank(restaurant.name) ||
    minimumStockLevel === null
  ) {
    throw new Error();
  }
  return Object.freeze({
    id: value.id,
    restaurantId: value.restaurant_id,
    restaurantName: restaurant.name,
    name: value.name,
    type: value.type,
    unitOfMeasure: value.unit_of_measure,
    minimumStockLevel,
  });
}

function mapBalance(
  value: unknown,
  items: ReadonlyMap<string, InventoryItemRow>,
) {
  if (
    !isRecord(value) ||
    !isUuid(value.restaurant_id) ||
    !isUuid(value.inventory_item_id) ||
    !isNonblank(value.unit_of_measure)
  ) {
    throw new Error();
  }
  const currentBalance = decimal(value.current_balance);
  const item = items.get(itemKey(value.restaurant_id, value.inventory_item_id));
  if (
    currentBalance === null ||
    item === undefined ||
    item.unitOfMeasure !== value.unit_of_measure
  ) {
    throw new Error();
  }
  return Object.freeze({
    restaurantId: value.restaurant_id,
    inventoryItemId: value.inventory_item_id,
    currentBalance,
  });
}

function mapMovement(
  value: unknown,
  items: ReadonlyMap<string, InventoryItemRow>,
): InventoryMovementView {
  if (!isRecord(value)) throw new Error();
  const recorder = singleRelation(value.recorded_by);
  const item =
    isUuid(value.restaurant_id) && isUuid(value.inventory_item_id)
      ? items.get(itemKey(value.restaurant_id, value.inventory_item_id))
      : undefined;
  const quantityDelta = decimal(value.quantity_delta);
  if (
    !isUuid(value.id) ||
    !item ||
    !isNonblank(value.type) ||
    quantityDelta === null ||
    !isNonblank(value.unit_of_measure) ||
    item.unitOfMeasure !== value.unit_of_measure ||
    !isUuid(value.recorded_by_id) ||
    !recorder ||
    recorder.id !== value.recorded_by_id ||
    !isNonblank(recorder.display_name) ||
    !timestamp(value.recorded_at) ||
    !isNonblank(value.business_origin_type) ||
    !isUuid(value.business_origin_id) ||
    !nullableText(value.comments, 2_000) ||
    !nullableUuid(value.reversed_movement_id)
  ) {
    throw new Error();
  }
  return Object.freeze({
    id: value.id,
    restaurantId: item.restaurantId,
    restaurantName: item.restaurantName,
    inventoryItemId: item.id,
    inventoryItemName: item.name,
    type: value.type,
    quantityDelta,
    unitOfMeasure: item.unitOfMeasure,
    recordedBy: Object.freeze({
      id: recorder.id,
      displayName: recorder.display_name,
    }),
    recordedAt: new Date(value.recorded_at).toISOString(),
    businessOrigin: Object.freeze({
      type: value.business_origin_type,
      id: value.business_origin_id,
    }),
    comments: value.comments,
    reversedMovementId: value.reversed_movement_id,
  });
}

function mapActiveAlert(
  value: unknown,
  items: ReadonlyMap<string, InventoryItemRow>,
): InventoryLowStockAlertView {
  if (!isRecord(value)) throw new Error();
  const item =
    isUuid(value.restaurant_id) && isUuid(value.inventory_item_id)
      ? items.get(itemKey(value.restaurant_id, value.inventory_item_id))
      : undefined;
  const threshold = decimal(value.threshold);
  const observedBalance = decimal(value.observed_balance);
  if (
    !isUuid(value.id) ||
    !item ||
    value.status !== "ACTIVE" ||
    value.resolved_at !== null ||
    threshold === null ||
    observedBalance === null ||
    !timestamp(value.opened_at) ||
    compareDecimal(observedBalance, threshold) >= 0
  ) {
    throw new Error();
  }
  return Object.freeze({
    id: value.id,
    restaurantId: item.restaurantId,
    restaurantName: item.restaurantName,
    inventoryItemId: item.id,
    inventoryItemName: item.name,
    unitOfMeasure: item.unitOfMeasure,
    threshold,
    observedBalance,
    openedAt: new Date(value.opened_at).toISOString(),
  });
}

function compareBalance(
  left: InventoryBalanceView,
  right: InventoryBalanceView,
) {
  return (
    left.restaurantName.localeCompare(right.restaurantName) ||
    left.inventoryItemName.localeCompare(right.inventoryItemName) ||
    left.inventoryItemId.localeCompare(right.inventoryItemId)
  );
}

function itemKey(restaurantId: string, inventoryItemId: string) {
  return `${restaurantId}:${inventoryItemId}`;
}

function decimal(value: unknown): string | null {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^-?\d+(?:\.\d{1,3})?$/.test(String(value))
  )
    return null;
  const raw = String(value);
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = (negative ? raw.slice(1) : raw).split(".");
  return `${negative ? "-" : ""}${whole.replace(/^0+(?=\d)/, "")}.${(fraction + "000").slice(0, 3)}`;
}

function compareDecimal(left: string, right: string) {
  const leftAmount = decimalToThousandths(left);
  const rightAmount = decimalToThousandths(right);
  return leftAmount < rightAmount ? -1 : leftAmount > rightAmount ? 1 : 0;
}

function decimalToThousandths(value: string) {
  const negative = value.startsWith("-");
  const [whole, fraction] = (negative ? value.slice(1) : value).split(".");
  const amount = BigInt(whole) * BigInt(1_000) + BigInt(fraction);
  return negative ? -amount : amount;
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function singleRelation(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  return Array.isArray(value) && value.length === 1 && isRecord(value[0])
    ? value[0]
    : null;
}
function nullableText(
  value: unknown,
  maximumLength: number,
): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && value.length <= maximumLength)
  );
}
function nullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}
function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
