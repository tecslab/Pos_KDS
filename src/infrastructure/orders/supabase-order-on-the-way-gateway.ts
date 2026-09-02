import type { SupabaseClient } from "@supabase/supabase-js";

import {
  onTheWayOrderResult,
  orderOnTheWayFailure,
  type MarkOrderOnTheWayCommand,
  type OnTheWayOrder,
  type OrderOnTheWayGateway,
} from "../../application";

export class SupabaseOrderOnTheWayGateway implements OrderOnTheWayGateway {
  constructor(private readonly client: SupabaseClient) {}

  async markOnTheWay(command: MarkOrderOnTheWayCommand) {
    try {
      const { data, error } = await this.client.rpc("mark_order_on_the_way", {
        actor_user_id: command.actorId,
        target_order_id: command.orderId,
        audit_occurred_at: command.occurredAt,
        audit_source_ip: command.sourceIp,
      });
      if (error) return mapFailure(error);
      if (!Array.isArray(data) || data.length !== 1)
        return orderOnTheWayFailure("OPERATION_FAILED");
      const order = mapOnTheWayOrder(data[0]);
      return order === null
        ? orderOnTheWayFailure("OPERATION_FAILED")
        : onTheWayOrderResult(order);
    } catch {
      return orderOnTheWayFailure("OPERATION_FAILED");
    }
  }
}

function mapFailure(error: unknown) {
  if (!isRecord(error)) return orderOnTheWayFailure("OPERATION_FAILED");
  if (error.code === "42501") return orderOnTheWayFailure("UNAUTHORIZED");
  if (error.code === "22023")
    return orderOnTheWayFailure("INVALID_ON_THE_WAY_TRANSITION");
  if (typeof error.message === "string") {
    if (error.message.includes("ORDER_ON_THE_WAY_NOT_FOUND"))
      return orderOnTheWayFailure("NOT_FOUND");
    if (error.message.includes("ORDER_ON_THE_WAY_NOT_READY"))
      return orderOnTheWayFailure("ORDER_NOT_READY");
  }
  return orderOnTheWayFailure("OPERATION_FAILED");
}

function mapOnTheWayOrder(value: unknown): OnTheWayOrder | null {
  if (
    !isRecord(value) ||
    !isUuid(value.order_id) ||
    !isUuid(value.restaurant_id) ||
    !isUuid(value.service_location_id) ||
    !isUuid(value.assigned_waiter_id) ||
    !isNonblank(value.order_number) ||
    value.previous_status !== "READY" ||
    value.status !== "ON_THE_WAY" ||
    !isUuid(value.collected_by_id) ||
    !isTimestamp(value.ready_at) ||
    !isTimestamp(value.on_the_way_at) ||
    !isTimestamp(value.updated_at)
  )
    return null;

  const readyAt = new Date(value.ready_at).toISOString();
  const onTheWayAt = new Date(value.on_the_way_at).toISOString();
  const updatedAt = new Date(value.updated_at).toISOString();
  if (onTheWayAt !== updatedAt || onTheWayAt < readyAt) return null;

  return Object.freeze({
    orderId: value.order_id,
    restaurantId: value.restaurant_id,
    serviceLocationId: value.service_location_id,
    orderNumber: value.order_number,
    assignedWaiterId: value.assigned_waiter_id,
    previousStatus: "READY",
    status: "ON_THE_WAY",
    collectedById: value.collected_by_id,
    readyAt,
    onTheWayAt,
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
