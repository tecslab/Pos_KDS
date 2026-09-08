import type { SupabaseClient } from "@supabase/supabase-js";
import type { InventoryReconciledMovement } from "../../domain";

import {
  orderCancellationFailure,
  persistedOrderCancellationResult,
  type CancelledOrder,
  type OrderCancellationCommand,
  type OrderCancellationGateway,
} from "../../application";
import { mapInventoryAlertTransitions } from "../inventory/map-inventory-alert-transitions";

export class SupabaseOrderCancellationGateway implements OrderCancellationGateway {
  constructor(private readonly client: SupabaseClient) {}

  async cancel(command: OrderCancellationCommand) {
    try {
      const { data, error } = await this.client.rpc("cancel_order", {
        actor_user_id: command.actorId,
        target_order_id: command.orderId,
        cancellation_reason: command.reason,
        audit_occurred_at: command.occurredAt,
        audit_source_ip: command.sourceIp,
      });
      if (error) return mapFailure(error);
      if (!Array.isArray(data) || data.length !== 1)
        return orderCancellationFailure("OPERATION_FAILED");
      const order = mapCancelledOrder(data[0]);
      const inventoryAlertTransitions = mapInventoryAlertTransitions(
        isRecord(data[0]) ? data[0].inventory_alert_transitions : null,
      );
      return order === null || inventoryAlertTransitions === null
        ? orderCancellationFailure("OPERATION_FAILED")
        : persistedOrderCancellationResult(
            Object.freeze({ ...order, inventoryAlertTransitions }),
          );
    } catch {
      return orderCancellationFailure("OPERATION_FAILED");
    }
  }
}

function mapFailure(error: unknown) {
  if (!isRecord(error)) return orderCancellationFailure("OPERATION_FAILED");
  if (error.code === "42501") return orderCancellationFailure("UNAUTHORIZED");
  if (error.code === "22023")
    return orderCancellationFailure("INVALID_CANCELLATION");
  if (typeof error.message === "string") {
    if (error.message.includes("ORDER_CANCELLATION_NOT_FOUND"))
      return orderCancellationFailure("NOT_FOUND");
    if (error.message.includes("ORDER_CANCELLATION_NOT_CANCELLABLE"))
      return orderCancellationFailure("ORDER_NOT_CANCELLABLE");
  }
  return orderCancellationFailure("OPERATION_FAILED");
}

function mapCancelledOrder(value: unknown): CancelledOrder | null {
  if (
    !isRecord(value) ||
    !isUuid(value.order_id) ||
    !isUuid(value.restaurant_id) ||
    !isUuid(value.service_location_id) ||
    !isUuid(value.assigned_waiter_id) ||
    !isNonblank(value.order_number) ||
    (value.previous_status !== "PENDING" &&
      value.previous_status !== "READY") ||
    value.status !== "CANCELLED" ||
    !isNonblank(value.reason) ||
    !isUuid(value.cancelled_by_id) ||
    !isTimestamp(value.cancelled_at) ||
    !isTimestamp(value.updated_at)
  )
    return null;

  const totalAmount = decimal(value.total_amount, 2, false);
  const inventoryMovements = mapInventoryMovements(value.inventory_movements);
  if (
    totalAmount === null ||
    inventoryMovements === null ||
    new Date(value.updated_at).getTime() !==
      new Date(value.cancelled_at).getTime()
  )
    return null;

  return Object.freeze({
    orderId: value.order_id,
    restaurantId: value.restaurant_id,
    serviceLocationId: value.service_location_id,
    orderNumber: value.order_number,
    assignedWaiterId: value.assigned_waiter_id,
    previousStatus: value.previous_status,
    status: "CANCELLED",
    totalAmount,
    reason: value.reason,
    cancelledById: value.cancelled_by_id,
    cancelledAt: new Date(value.cancelled_at).toISOString(),
    updatedAt: new Date(value.updated_at).toISOString(),
    inventoryMovements,
  });
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
      candidate.type !== "ROLLBACK" ||
      !isNonblank(candidate.unit_of_measure) ||
      !isUuid(candidate.reversed_movement_id)
    )
      return null;
    const quantityDelta = decimal(candidate.quantity_delta, 3, true);
    if (quantityDelta === null || Number(quantityDelta) <= 0) return null;
    ids.add(candidate.inventory_movement_id);
    movements.push(
      Object.freeze({
        inventoryMovementId: candidate.inventory_movement_id,
        inventoryItemId: candidate.inventory_item_id,
        type: "ROLLBACK",
        quantityDelta,
        unitOfMeasure: candidate.unit_of_measure,
        reversedMovementId: candidate.reversed_movement_id,
      }),
    );
  }
  return Object.freeze(movements);
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
