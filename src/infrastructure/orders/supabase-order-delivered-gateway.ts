import type { SupabaseClient } from "@supabase/supabase-js";

import {
  deliveredOrderResult,
  orderDeliveredFailure,
  type DeliveredOrder,
  type MarkOrderDeliveredCommand,
  type OrderDeliveredGateway,
} from "../../application";

export class SupabaseOrderDeliveredGateway implements OrderDeliveredGateway {
  constructor(private readonly client: SupabaseClient) {}

  async markDelivered(command: MarkOrderDeliveredCommand) {
    try {
      const { data, error } = await this.client.rpc("mark_order_delivered", {
        actor_user_id: command.actorId,
        target_order_id: command.orderId,
        audit_occurred_at: command.occurredAt,
        audit_source_ip: command.sourceIp,
      });
      if (error) return mapFailure(error);
      if (!Array.isArray(data) || data.length !== 1)
        return orderDeliveredFailure("OPERATION_FAILED");
      const order = mapDeliveredOrder(data[0]);
      return order === null
        ? orderDeliveredFailure("OPERATION_FAILED")
        : deliveredOrderResult(order);
    } catch {
      return orderDeliveredFailure("OPERATION_FAILED");
    }
  }
}

function mapFailure(error: unknown) {
  if (!isRecord(error)) return orderDeliveredFailure("OPERATION_FAILED");
  if (error.code === "42501") return orderDeliveredFailure("UNAUTHORIZED");
  if (error.code === "22023")
    return orderDeliveredFailure("INVALID_DELIVERED_TRANSITION");
  if (typeof error.message === "string") {
    if (error.message.includes("ORDER_DELIVERED_NOT_FOUND"))
      return orderDeliveredFailure("NOT_FOUND");
    if (error.message.includes("ORDER_DELIVERED_NOT_ON_THE_WAY"))
      return orderDeliveredFailure("ORDER_NOT_ON_THE_WAY");
  }
  return orderDeliveredFailure("OPERATION_FAILED");
}

function mapDeliveredOrder(value: unknown): DeliveredOrder | null {
  if (
    !isRecord(value) ||
    !isUuid(value.order_id) ||
    !isUuid(value.restaurant_id) ||
    !isUuid(value.service_location_id) ||
    !isUuid(value.assigned_waiter_id) ||
    !isNonblank(value.order_number) ||
    value.previous_status !== "ON_THE_WAY" ||
    value.status !== "DELIVERED" ||
    !isUuid(value.delivered_by_id) ||
    !isTimestamp(value.ready_at) ||
    !isTimestamp(value.on_the_way_at) ||
    !isTimestamp(value.delivered_at) ||
    !isTimestamp(value.updated_at)
  )
    return null;

  const readyAt = new Date(value.ready_at).toISOString();
  const onTheWayAt = new Date(value.on_the_way_at).toISOString();
  const deliveredAt = new Date(value.delivered_at).toISOString();
  const updatedAt = new Date(value.updated_at).toISOString();
  if (
    deliveredAt !== updatedAt ||
    onTheWayAt < readyAt ||
    deliveredAt < onTheWayAt
  )
    return null;

  return Object.freeze({
    orderId: value.order_id,
    restaurantId: value.restaurant_id,
    serviceLocationId: value.service_location_id,
    orderNumber: value.order_number,
    assignedWaiterId: value.assigned_waiter_id,
    previousStatus: "ON_THE_WAY",
    status: "DELIVERED",
    deliveredById: value.delivered_by_id,
    readyAt,
    onTheWayAt,
    deliveredAt,
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
