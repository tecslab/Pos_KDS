import type { SupabaseClient } from "@supabase/supabase-js";

import {
  inventoryAdjustmentWasteRegistrationFailure,
  registeredInventoryAdjustmentWasteResult,
  type InventoryAdjustmentWasteRegistrationGateway,
  type RegisterInventoryAdjustmentWasteCommand,
  type RegisteredInventoryAdjustmentWaste,
} from "../../application";

export class SupabaseInventoryAdjustmentWasteRegistrationGateway implements InventoryAdjustmentWasteRegistrationGateway {
  constructor(private readonly client: SupabaseClient) {}

  async register(command: RegisterInventoryAdjustmentWasteCommand) {
    try {
      const { data, error } = await this.client.rpc(
        "register_inventory_adjustment_or_waste",
        {
          actor_user_id: command.actorId,
          target_restaurant_id: command.restaurantId,
          target_inventory_item_id: command.inventoryItemId,
          movement_operation: command.operation,
          quantity_text: command.quantity,
          movement_reason: command.reason,
          audit_occurred_at: command.occurredAt,
          audit_source_ip: command.sourceIp,
        },
      );
      if (error) return mapFailure(error);
      if (!Array.isArray(data) || data.length !== 1) {
        return inventoryAdjustmentWasteRegistrationFailure("OPERATION_FAILED");
      }
      const movement = mapRegisteredInventoryAdjustmentWaste(data[0]);
      return movement === null
        ? inventoryAdjustmentWasteRegistrationFailure("OPERATION_FAILED")
        : registeredInventoryAdjustmentWasteResult(movement);
    } catch {
      return inventoryAdjustmentWasteRegistrationFailure("OPERATION_FAILED");
    }
  }
}

function mapFailure(error: unknown) {
  if (!isRecord(error)) {
    return inventoryAdjustmentWasteRegistrationFailure("OPERATION_FAILED");
  }
  if (error.code === "42501") {
    return inventoryAdjustmentWasteRegistrationFailure("UNAUTHORIZED");
  }
  if (error.code === "22023") {
    return inventoryAdjustmentWasteRegistrationFailure("INVALID_MOVEMENT");
  }
  if (typeof error.message === "string") {
    if (error.message.includes("INVENTORY_MOVEMENT_RESTAURANT_UNAVAILABLE")) {
      return inventoryAdjustmentWasteRegistrationFailure(
        "RESTAURANT_UNAVAILABLE",
      );
    }
    if (error.message.includes("INVENTORY_MOVEMENT_ITEM_UNAVAILABLE")) {
      return inventoryAdjustmentWasteRegistrationFailure(
        "INVENTORY_ITEM_UNAVAILABLE",
      );
    }
    if (
      error.message.includes("INVENTORY_MOVEMENT_NEGATIVE_STOCK_DISALLOWED") ||
      error.message.includes(
        "inventory movement would produce a negative balance",
      )
    ) {
      return inventoryAdjustmentWasteRegistrationFailure(
        "NEGATIVE_STOCK_DISALLOWED",
      );
    }
  }
  return inventoryAdjustmentWasteRegistrationFailure("OPERATION_FAILED");
}

export function mapRegisteredInventoryAdjustmentWaste(
  value: unknown,
): RegisteredInventoryAdjustmentWaste | null {
  if (
    !isRecord(value) ||
    !isUuid(value.origin_id) ||
    !isUuid(value.inventory_movement_id) ||
    !isUuid(value.restaurant_id) ||
    !isUuid(value.inventory_item_id) ||
    (value.operation_type !== "ADJUSTMENT" &&
      value.operation_type !== "WASTE") ||
    !isUuid(value.recorded_by_id) ||
    !isNonblank(value.unit_of_measure) ||
    !isNonblank(value.reason)
  ) {
    return null;
  }

  const quantityDelta = decimal(value.quantity_delta);
  const previousBalance = decimal(value.previous_balance);
  const newBalance = decimal(value.new_balance);
  const recordedAt = timestamp(value.recorded_at);
  if (
    quantityDelta === null ||
    quantityDelta === "0.000" ||
    previousBalance === null ||
    newBalance === null ||
    recordedAt === null ||
    (value.operation_type === "WASTE" && !quantityDelta.startsWith("-")) ||
    scaledInteger(previousBalance) + scaledInteger(quantityDelta) !==
      scaledInteger(newBalance)
  ) {
    return null;
  }

  return Object.freeze({
    originId: value.origin_id,
    inventoryMovementId: value.inventory_movement_id,
    restaurantId: value.restaurant_id,
    inventoryItemId: value.inventory_item_id,
    operation: value.operation_type,
    quantityDelta,
    unitOfMeasure: value.unit_of_measure,
    reason: value.reason,
    recordedById: value.recorded_by_id,
    recordedAt,
    previousBalance,
    newBalance,
  });
}

function decimal(value: unknown) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^-?\d+(?:\.\d+)?$/.test(String(value))
  ) {
    return null;
  }
  const [integer, fraction = ""] = String(value).split(".");
  if (fraction.length > 3 && /[1-9]/.test(fraction.slice(3))) return null;
  const negative = integer.startsWith("-");
  const absoluteInteger = negative ? integer.slice(1) : integer;
  const scaled =
    BigInt(absoluteInteger) * BigInt(1_000) +
    BigInt((fraction + "000").slice(0, 3));
  const canonical = scaled.toString().padStart(4, "0");
  if (scaled === BigInt(0)) return "0.000";
  return `${negative ? "-" : ""}${canonical.slice(0, -3)}.${canonical.slice(-3)}`;
}

function scaledInteger(value: string) {
  return BigInt(value.replace(".", ""));
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
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
