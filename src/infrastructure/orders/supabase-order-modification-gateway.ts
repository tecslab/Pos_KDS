import type { SupabaseClient } from "@supabase/supabase-js";
import type { InventoryReconciledMovement } from "../../domain";

import {
  orderModificationFailure,
  persistedOrderModificationResult,
  type ModifiedOrder,
  type ModifiedOrderBasket,
  type ModifiedOrderLine,
  type ModifiedOrderModification,
  type OrderModificationCommand,
  type OrderModificationGateway,
} from "../../application";

export class SupabaseOrderModificationGateway implements OrderModificationGateway {
  constructor(private readonly client: SupabaseClient) {}

  async modify(command: OrderModificationCommand) {
    try {
      const { data, error } = await this.client.rpc("modify_pending_order", {
        actor_user_id: command.actorId,
        target_order_id: command.orderId,
        expected_order_updated_at: command.expectedUpdatedAt,
        operations_text: JSON.stringify(command.operations),
        audit_occurred_at: command.occurredAt,
        audit_source_ip: command.sourceIp,
      });
      if (error) return mapFailure(error);
      if (!Array.isArray(data) || data.length !== 1)
        return orderModificationFailure("OPERATION_FAILED");
      const persisted = mapPersistedModification(data[0]);
      return persisted === null
        ? orderModificationFailure("OPERATION_FAILED")
        : persistedOrderModificationResult(persisted);
    } catch {
      return orderModificationFailure("OPERATION_FAILED");
    }
  }
}

function mapFailure(error: unknown) {
  if (!isRecord(error)) return orderModificationFailure("OPERATION_FAILED");
  if (error.code === "42501") return orderModificationFailure("UNAUTHORIZED");
  if (error.code === "22023")
    return orderModificationFailure("INVALID_MODIFICATION");
  if (typeof error.message === "string") {
    const mappings = [
      ["ORDER_MODIFICATION_NOT_FOUND", "NOT_FOUND"],
      ["ORDER_MODIFICATION_NOT_PENDING", "ORDER_NOT_PENDING"],
      ["ORDER_MODIFICATION_STALE_ORDER", "STALE_ORDER"],
      ["ORDER_MODIFICATION_STALE_CONFIGURATION", "STALE_CONFIGURATION"],
      ["ORDER_MODIFICATION_INSUFFICIENT_INVENTORY", "INSUFFICIENT_INVENTORY"],
    ] as const;
    for (const [marker, code] of mappings)
      if (error.message.includes(marker)) return orderModificationFailure(code);
  }
  return orderModificationFailure("OPERATION_FAILED");
}

function mapPersistedModification(value: unknown) {
  if (!isRecord(value)) return null;
  const order = mapOrder(value);
  const inventoryMovements = mapInventoryMovements(value.inventory_movements);
  if (order === null || inventoryMovements === null) return null;
  return Object.freeze({ order, inventoryMovements });
}

function mapInventoryMovements(
  value: unknown,
): readonly InventoryReconciledMovement[] | null {
  if (!Array.isArray(value) || value.length > 1_000) return null;
  const ids = new Set<string>();
  const movements: InventoryReconciledMovement[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !isUuid(candidate.inventory_movement_id) ||
      ids.has(candidate.inventory_movement_id) ||
      !isUuid(candidate.inventory_item_id) ||
      (candidate.type !== "SALE" && candidate.type !== "ROLLBACK") ||
      !isNonblank(candidate.unit_of_measure) ||
      (candidate.reversed_movement_id !== null &&
        !isUuid(candidate.reversed_movement_id))
    )
      return null;
    const quantityDelta = signedQuantity(candidate.quantity_delta);
    if (
      quantityDelta === null ||
      Number(quantityDelta) === 0 ||
      (candidate.type === "SALE" && Number(quantityDelta) >= 0) ||
      (candidate.type === "ROLLBACK" && Number(quantityDelta) <= 0) ||
      (candidate.type === "SALE" && candidate.reversed_movement_id !== null) ||
      (candidate.type === "ROLLBACK" && candidate.reversed_movement_id === null)
    )
      return null;
    ids.add(candidate.inventory_movement_id);
    movements.push(
      Object.freeze({
        inventoryMovementId: candidate.inventory_movement_id,
        inventoryItemId: candidate.inventory_item_id,
        type: candidate.type,
        quantityDelta,
        unitOfMeasure: candidate.unit_of_measure,
        reversedMovementId: candidate.reversed_movement_id,
      }),
    );
  }
  return Object.freeze(movements);
}

function mapOrder(value: unknown): ModifiedOrder | null {
  if (
    !isRecord(value) ||
    !isUuid(value.order_id) ||
    !isUuid(value.restaurant_id) ||
    !isUuid(value.service_location_id) ||
    !isUuid(value.assigned_waiter_id) ||
    !isNonblank(value.order_number) ||
    value.status !== "PENDING" ||
    !isTimestamp(value.updated_at) ||
    !Array.isArray(value.baskets)
  )
    return null;
  const totalAmount = money(value.total_amount);
  if (totalAmount === null || value.baskets.length < 1) return null;
  const baskets: ModifiedOrderBasket[] = [];
  const basketIds = new Set<string>();
  const lineIds = new Set<string>();
  for (const candidate of value.baskets) {
    const basket = mapBasket(candidate, value.restaurant_id, lineIds);
    if (basket === null || basketIds.has(basket.id)) return null;
    basketIds.add(basket.id);
    baskets.push(basket);
  }
  if (sumMoney(baskets.map((basket) => basket.totalAmount)) !== totalAmount)
    return null;
  return Object.freeze({
    orderId: value.order_id,
    restaurantId: value.restaurant_id,
    serviceLocationId: value.service_location_id,
    orderNumber: value.order_number,
    assignedWaiterId: value.assigned_waiter_id,
    status: "PENDING",
    totalAmount,
    updatedAt: new Date(value.updated_at).toISOString(),
    baskets: Object.freeze(baskets),
  });
}

function mapBasket(
  value: unknown,
  restaurantId: string,
  lineIds: Set<string>,
): ModifiedOrderBasket | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    value.restaurantId !== restaurantId ||
    !Array.isArray(value.lines) ||
    value.lines.length < 1
  )
    return null;
  const totalAmount = money(value.totalAmount);
  if (totalAmount === null) return null;
  const lines: ModifiedOrderLine[] = [];
  for (const candidate of value.lines) {
    const line = mapLine(candidate);
    if (line === null || lineIds.has(line.id)) return null;
    lineIds.add(line.id);
    lines.push(line);
  }
  if (sumMoney(lines.map((line) => line.lineTotal)) !== totalAmount)
    return null;
  return Object.freeze({
    id: value.id,
    totalAmount,
    lines: Object.freeze(lines),
  });
}

function mapLine(value: unknown): ModifiedOrderLine | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.currentSnapshotId) ||
    !Number.isInteger(value.revisionNumber) ||
    (value.revisionNumber as number) < 1 ||
    !isUuid(value.productVersionId) ||
    !isNonblank(value.productName) ||
    !Number.isInteger(value.quantity) ||
    (value.quantity as number) < 1 ||
    !isNonblank(value.taxCode) ||
    !isNonblank(value.taxName) ||
    typeof value.priceIncludesTax !== "boolean" ||
    !Array.isArray(value.selectedOptions) ||
    !Array.isArray(value.removedIngredients) ||
    (value.observations !== null && typeof value.observations !== "string")
  )
    return null;
  const baseUnitPrice = money(value.baseUnitPrice);
  const finalUnitPrice = money(value.finalUnitPrice);
  const lineTotal = money(value.lineTotal);
  const taxRate = rate(value.taxRate);
  const selectedOptions = mapModifications(value.selectedOptions);
  const removedIngredients = mapModifications(value.removedIngredients);
  if (
    baseUnitPrice === null ||
    finalUnitPrice === null ||
    lineTotal === null ||
    taxRate === null ||
    selectedOptions === null ||
    removedIngredients === null ||
    (Number(finalUnitPrice) * (value.quantity as number)).toFixed(2) !==
      lineTotal
  )
    return null;
  return Object.freeze({
    id: value.id,
    currentSnapshotId: value.currentSnapshotId,
    revisionNumber: value.revisionNumber as number,
    productVersionId: value.productVersionId,
    productName: value.productName,
    quantity: value.quantity as number,
    baseUnitPrice,
    finalUnitPrice,
    lineTotal,
    taxCode: value.taxCode,
    taxName: value.taxName,
    taxRate,
    priceIncludesTax: value.priceIncludesTax,
    selectedOptions,
    removedIngredients,
    observations: value.observations,
  });
}

function mapModifications(
  values: readonly unknown[],
): readonly ModifiedOrderModification[] | null {
  const ids = new Set<string>();
  const result: ModifiedOrderModification[] = [];
  for (const value of values) {
    if (
      !isRecord(value) ||
      !isUuid(value.id) ||
      ids.has(value.id) ||
      !isNonblank(value.name)
    )
      return null;
    const priceAdjustment =
      value.priceAdjustment === null
        ? null
        : signedMoney(value.priceAdjustment);
    if (value.priceAdjustment !== null && priceAdjustment === null) return null;
    ids.add(value.id);
    result.push(
      Object.freeze({ id: value.id, name: value.name, priceAdjustment }),
    );
  }
  return Object.freeze(result);
}

function money(value: unknown) {
  return decimal(value, 2, false);
}
function signedMoney(value: unknown) {
  return decimal(value, 2, true);
}
function rate(value: unknown) {
  const result = decimal(value, 6, false);
  return result !== null && Number(result) <= 1 ? result : null;
}
function signedQuantity(value: unknown) {
  return decimal(value, 3, true);
}
function decimal(value: unknown, scale: number, signed: boolean) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !Number.isFinite(Number(value))
  )
    return null;
  const pattern = signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/;
  if (!pattern.test(String(value))) return null;
  const number = Number(value);
  if (!signed && number < 0) return null;
  return number.toFixed(scale);
}
function sumMoney(values: readonly string[]) {
  return values.reduce((sum, value) => sum + Number(value), 0).toFixed(2);
}
function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" && Number.isFinite(new Date(value).getTime())
  );
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
