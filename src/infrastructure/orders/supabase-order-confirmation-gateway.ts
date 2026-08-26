import type { SupabaseClient } from "@supabase/supabase-js";

import {
  confirmedOrderResult,
  orderConfirmationFailure,
  type ConfirmedOrder,
  type ConfirmedOrderBasket,
  type ConfirmedOrderLine,
  type ConfirmedOrderModification,
  type OrderConfirmationCommand,
  type OrderConfirmationGateway,
} from "../../application";

export class SupabaseOrderConfirmationGateway implements OrderConfirmationGateway {
  constructor(private readonly client: SupabaseClient) {}

  async confirm(command: OrderConfirmationCommand) {
    try {
      const { data, error } = await this.client.rpc("confirm_order", {
        actor_user_id: command.actorId,
        target_service_location_id: command.serviceLocationId,
        order_notes: command.notes,
        draft_baskets_text: JSON.stringify(command.baskets),
        audit_occurred_at: command.occurredAt,
        audit_source_ip: command.sourceIp,
      });

      if (error) return mapPersistenceFailure(error);
      if (!Array.isArray(data) || data.length !== 1) {
        return orderConfirmationFailure("OPERATION_FAILED");
      }
      const order = mapConfirmedOrder(data[0]);
      return order === null
        ? orderConfirmationFailure("OPERATION_FAILED")
        : confirmedOrderResult(order);
    } catch {
      return orderConfirmationFailure("OPERATION_FAILED");
    }
  }
}

function mapPersistenceFailure(error: unknown) {
  if (!isRecord(error)) return orderConfirmationFailure("OPERATION_FAILED");
  if (error.code === "42501") return orderConfirmationFailure("UNAUTHORIZED");
  if (error.code === "22023") return orderConfirmationFailure("INVALID_DRAFT");
  if (typeof error.message === "string") {
    if (error.message.includes("ORDER_CONFIRMATION_LOCATION_UNAVAILABLE")) {
      return orderConfirmationFailure("LOCATION_UNAVAILABLE");
    }
    if (error.message.includes("ORDER_CONFIRMATION_STALE_CONFIGURATION")) {
      return orderConfirmationFailure("STALE_CONFIGURATION");
    }
  }
  return orderConfirmationFailure("OPERATION_FAILED");
}

function mapConfirmedOrder(value: unknown): ConfirmedOrder | null {
  if (
    !isRecord(value) ||
    !isUuid(value.order_id) ||
    !isUuid(value.restaurant_id) ||
    !isUuid(value.service_location_id) ||
    typeof value.order_number !== "string" ||
    !/^ORD-[1-9]\d*$/.test(value.order_number) ||
    !isUuid(value.assigned_waiter_id) ||
    value.status !== "PENDING" ||
    (value.notes !== null && typeof value.notes !== "string") ||
    !isTimestamp(value.confirmed_at) ||
    !Array.isArray(value.baskets)
  ) {
    return null;
  }
  const totalAmount = money(value.total_amount);
  if (totalAmount === null) return null;
  const baskets: ConfirmedOrderBasket[] = [];
  for (const basket of value.baskets) {
    const mapped = mapBasket(basket);
    if (mapped === null) return null;
    baskets.push(mapped);
  }
  if (baskets.length === 0) return null;
  const computedTotal = baskets.reduce(
    (sum, basket) => sum + Number(basket.totalAmount),
    0,
  );
  if (computedTotal.toFixed(2) !== totalAmount) return null;

  return Object.freeze({
    orderId: value.order_id,
    restaurantId: value.restaurant_id,
    serviceLocationId: value.service_location_id,
    orderNumber: value.order_number,
    assignedWaiterId: value.assigned_waiter_id,
    status: "PENDING",
    notes: value.notes,
    totalAmount,
    confirmedAt: new Date(value.confirmed_at).toISOString(),
    baskets: Object.freeze(baskets),
  });
}

function mapBasket(value: unknown): ConfirmedOrderBasket | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    value.status !== "PENDING" ||
    !Array.isArray(value.lines)
  ) {
    return null;
  }
  const totalAmount = money(value.totalAmount);
  if (totalAmount === null) return null;
  const lines: ConfirmedOrderLine[] = [];
  for (const line of value.lines) {
    const mapped = mapLine(line);
    if (mapped === null) return null;
    lines.push(mapped);
  }
  if (lines.length === 0) return null;
  const computedTotal = lines.reduce(
    (sum, line) => sum + Number(line.lineTotal),
    0,
  );
  if (computedTotal.toFixed(2) !== totalAmount) return null;
  return Object.freeze({
    id: value.id,
    status: "PENDING",
    totalAmount,
    lines: Object.freeze(lines),
  });
}

function mapLine(value: unknown): ConfirmedOrderLine | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.productVersionId) ||
    typeof value.productName !== "string" ||
    value.productName.trim().length === 0 ||
    typeof value.quantity !== "number" ||
    !Number.isInteger(value.quantity) ||
    value.quantity < 1 ||
    typeof value.taxCode !== "string" ||
    value.taxCode.trim().length === 0 ||
    typeof value.taxName !== "string" ||
    value.taxName.trim().length === 0 ||
    typeof value.priceIncludesTax !== "boolean" ||
    !Array.isArray(value.selectedOptions) ||
    !Array.isArray(value.removedIngredients) ||
    (value.observations !== null && typeof value.observations !== "string")
  ) {
    return null;
  }
  const baseUnitPrice = money(value.baseUnitPrice);
  const finalUnitPrice = money(value.finalUnitPrice);
  const lineTotal = money(value.lineTotal);
  const taxRate = rate(value.taxRate);
  if (
    baseUnitPrice === null ||
    finalUnitPrice === null ||
    lineTotal === null ||
    taxRate === null ||
    (Number(finalUnitPrice) * value.quantity).toFixed(2) !== lineTotal
  ) {
    return null;
  }
  const selectedOptions = mapModifications(value.selectedOptions);
  const removedIngredients = mapModifications(value.removedIngredients);
  if (selectedOptions === null || removedIngredients === null) return null;
  return Object.freeze({
    id: value.id,
    productVersionId: value.productVersionId,
    productName: value.productName,
    quantity: value.quantity,
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
): readonly ConfirmedOrderModification[] | null {
  const modifications: ConfirmedOrderModification[] = [];
  const ids = new Set<string>();
  for (const value of values) {
    if (
      !isRecord(value) ||
      Reflect.ownKeys(value).length !== 3 ||
      !isUuid(value.id) ||
      ids.has(value.id) ||
      typeof value.name !== "string" ||
      value.name.trim().length === 0
    ) {
      return null;
    }
    const priceAdjustment =
      value.priceAdjustment === null
        ? null
        : signedMoney(value.priceAdjustment);
    if (value.priceAdjustment !== null && priceAdjustment === null) return null;
    ids.add(value.id);
    modifications.push(
      Object.freeze({ id: value.id, name: value.name, priceAdjustment }),
    );
  }
  return Object.freeze(modifications);
}

function money(value: unknown) {
  const number = decimal(value);
  return number !== null && number >= 0 && number <= 9_999_999_999.99
    ? number.toFixed(2)
    : null;
}

function signedMoney(value: unknown) {
  const number = decimal(value);
  return number !== null && Math.abs(number) <= 9_999_999_999.99
    ? number.toFixed(2)
    : null;
}

function rate(value: unknown) {
  const number = decimal(value);
  return number !== null && number >= 0 && number <= 1
    ? number.toFixed(6)
    : null;
}

function decimal(value: unknown) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    value === "" ||
    !/^-?\d+(?:\.\d+)?$/.test(String(value))
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
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
