import type { SupabaseClient } from "@supabase/supabase-js";

import {
  orderReadyFailure,
  readyOrderResult,
  type MarkOrderReadyCommand,
  type OrderReadyGateway,
  type ReadyOrder,
} from "../../application";

export class SupabaseOrderReadyGateway implements OrderReadyGateway {
  constructor(private readonly client: SupabaseClient) {}

  async markReady(command: MarkOrderReadyCommand) {
    try {
      const { data, error } = await this.client.rpc("mark_order_ready", {
        actor_user_id: command.actorId,
        target_order_id: command.orderId,
        audit_occurred_at: command.occurredAt,
        audit_source_ip: command.sourceIp,
      });
      if (error) return mapFailure(error);
      if (!Array.isArray(data) || data.length !== 1)
        return orderReadyFailure("OPERATION_FAILED");
      const order = mapReadyOrder(data[0]);
      return order === null
        ? orderReadyFailure("OPERATION_FAILED")
        : readyOrderResult(order);
    } catch {
      return orderReadyFailure("OPERATION_FAILED");
    }
  }
}

function mapFailure(error: unknown) {
  if (!isRecord(error)) return orderReadyFailure("OPERATION_FAILED");
  if (error.code === "42501") return orderReadyFailure("UNAUTHORIZED");
  if (error.code === "22023")
    return orderReadyFailure("INVALID_READY_TRANSITION");
  if (typeof error.message === "string") {
    if (error.message.includes("ORDER_READY_NOT_FOUND"))
      return orderReadyFailure("NOT_FOUND");
    if (error.message.includes("ORDER_READY_NOT_PENDING"))
      return orderReadyFailure("ORDER_NOT_PENDING");
  }
  return orderReadyFailure("OPERATION_FAILED");
}

function mapReadyOrder(value: unknown): ReadyOrder | null {
  if (
    !isRecord(value) ||
    !isUuid(value.order_id) ||
    !isUuid(value.restaurant_id) ||
    !isUuid(value.service_location_id) ||
    !isUuid(value.assigned_waiter_id) ||
    !isNonblank(value.order_number) ||
    value.previous_status !== "PENDING" ||
    value.status !== "READY" ||
    !isUuid(value.marked_ready_by_id) ||
    !isTimestamp(value.ready_at) ||
    !isTimestamp(value.updated_at)
  )
    return null;

  const readyAt = new Date(value.ready_at).toISOString();
  const updatedAt = new Date(value.updated_at).toISOString();
  if (readyAt !== updatedAt) return null;

  return Object.freeze({
    orderId: value.order_id,
    restaurantId: value.restaurant_id,
    serviceLocationId: value.service_location_id,
    orderNumber: value.order_number,
    assignedWaiterId: value.assigned_waiter_id,
    previousStatus: "PENDING",
    status: "READY",
    markedReadyById: value.marked_ready_by_id,
    readyAt,
    updatedAt,
  });
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
