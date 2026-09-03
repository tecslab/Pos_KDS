import type { SupabaseClient } from "@supabase/supabase-js";

import {
  paymentRegistrationFailure,
  registeredPaymentResult,
  type PaymentRegistrationGateway,
  type RegisterPaymentCommand,
  type RegisteredPayment,
} from "../../application";

export class SupabasePaymentRegistrationGateway implements PaymentRegistrationGateway {
  constructor(private readonly client: SupabaseClient) {}

  async register(command: RegisterPaymentCommand) {
    try {
      const { data, error } = await this.client.rpc("register_payment", {
        actor_user_id: command.actorId,
        target_basket_id: command.basketId,
        target_payment_method_id: command.paymentMethodId,
        payment_amount: command.amount,
        payment_reference_number: command.referenceNumber,
        payment_comments: command.comments,
        overage_authorization_reason: command.overageReason,
        audit_occurred_at: command.occurredAt,
        audit_source_ip: command.sourceIp,
      });
      if (error) return mapFailure(error);
      if (!Array.isArray(data) || data.length !== 1) {
        return paymentRegistrationFailure("OPERATION_FAILED");
      }
      const payment = mapRegisteredPayment(data[0]);
      return payment === null
        ? paymentRegistrationFailure("OPERATION_FAILED")
        : registeredPaymentResult(payment);
    } catch {
      return paymentRegistrationFailure("OPERATION_FAILED");
    }
  }
}

function mapFailure(error: unknown) {
  if (!isRecord(error)) return paymentRegistrationFailure("OPERATION_FAILED");
  if (typeof error.message === "string") {
    if (error.message.includes("PAYMENT_OVERAGE_UNAUTHORIZED")) {
      return paymentRegistrationFailure("OVERAGE_NOT_AUTHORIZED");
    }
    if (error.message.includes("PAYMENT_OVERAGE_REASON_REQUIRED")) {
      return paymentRegistrationFailure("OVERAGE_REASON_REQUIRED");
    }
    if (
      error.message.includes("PAYMENT_BASKET_NOT_FOUND") ||
      error.message.includes("PAYMENT_ORDER_NOT_FOUND")
    ) {
      return paymentRegistrationFailure("NOT_FOUND");
    }
    if (error.message.includes("PAYMENT_ORDER_NOT_DELIVERED")) {
      return paymentRegistrationFailure("ORDER_NOT_DELIVERED");
    }
    if (error.message.includes("PAYMENT_BASKET_ALREADY_PAID")) {
      return paymentRegistrationFailure("BASKET_ALREADY_PAID");
    }
    if (error.message.includes("PAYMENT_METHOD_UNAVAILABLE")) {
      return paymentRegistrationFailure("PAYMENT_METHOD_UNAVAILABLE");
    }
  }
  if (error.code === "42501") {
    return paymentRegistrationFailure("UNAUTHORIZED");
  }
  if (error.code === "22023") {
    return paymentRegistrationFailure("INVALID_PAYMENT");
  }
  return paymentRegistrationFailure("OPERATION_FAILED");
}

function mapRegisteredPayment(value: unknown): RegisteredPayment | null {
  if (
    !isRecord(value) ||
    !isUuid(value.payment_id) ||
    !isUuid(value.restaurant_id) ||
    !isUuid(value.order_id) ||
    !isUuid(value.basket_id) ||
    !isUuid(value.payment_method_id) ||
    !isUuid(value.recorded_by_id) ||
    !isNonblank(value.payment_method_code) ||
    !isNonblank(value.payment_method_name) ||
    !(
      value.reference_number === null ||
      typeof value.reference_number === "string"
    ) ||
    !(value.comments === null || typeof value.comments === "string") ||
    value.basket_previous_status !== "PENDING" ||
    (value.basket_status !== "PENDING" && value.basket_status !== "PAID") ||
    value.order_previous_status !== "DELIVERED" ||
    (value.order_status !== "DELIVERED" && value.order_status !== "PAID")
  ) {
    return null;
  }

  const amount = money(value.amount, true);
  const basketTotalAmount = money(value.basket_total_amount, true);
  const basketPaidAmount = money(value.basket_paid_amount, false);
  const basketOutstandingBalance = money(
    value.basket_outstanding_balance,
    true,
  );
  const recordedAt = timestamp(value.recorded_at);
  const orderPaidAt = nullableTimestamp(value.order_paid_at);
  if (
    amount === null ||
    amount === "0.00" ||
    basketTotalAmount === null ||
    basketPaidAmount === null ||
    basketOutstandingBalance === null ||
    recordedAt === null ||
    orderPaidAt === undefined
  ) {
    return null;
  }

  const total = cents(basketTotalAmount);
  const paid = cents(basketPaidAmount);
  const outstanding = cents(basketOutstandingBalance);
  const expectedOutstanding = total > paid ? total - paid : BigInt(0);
  if (outstanding !== expectedOutstanding) return null;

  const hasOverage = paid > total;
  const overageAuthorizedAt = nullableTimestamp(value.overage_authorized_at);
  const evidenceIsValid = hasOverage
    ? value.overage_authorized_by_id === value.recorded_by_id &&
      overageAuthorizedAt === recordedAt &&
      isNonblank(value.overage_reason)
    : value.overage_authorized_by_id === null &&
      overageAuthorizedAt === null &&
      value.overage_reason === null;
  if (!evidenceIsValid || overageAuthorizedAt === undefined) return null;

  if (
    (value.basket_status === "PAID") !== (outstanding === BigInt(0)) ||
    (value.order_status === "PAID" &&
      (value.basket_status !== "PAID" || orderPaidAt !== recordedAt)) ||
    (value.order_status === "DELIVERED" && orderPaidAt !== null)
  ) {
    return null;
  }

  return Object.freeze({
    paymentId: value.payment_id,
    restaurantId: value.restaurant_id,
    orderId: value.order_id,
    basketId: value.basket_id,
    paymentMethodId: value.payment_method_id,
    recordedById: value.recorded_by_id,
    amount,
    paymentMethodCode: value.payment_method_code,
    paymentMethodName: value.payment_method_name,
    referenceNumber: value.reference_number,
    comments: value.comments,
    recordedAt,
    overageAuthorizedById: value.overage_authorized_by_id as string | null,
    overageAuthorizedAt,
    overageReason: value.overage_reason as string | null,
    basketTotalAmount,
    basketPaidAmount,
    basketOutstandingBalance,
    basketPreviousStatus: "PENDING",
    basketStatus: value.basket_status,
    orderPreviousStatus: "DELIVERED",
    orderStatus: value.order_status,
    orderPaidAt,
  });
}

function money(value: unknown, bounded: boolean): string | null {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+(?:\.\d+)?$/.test(String(value))
  ) {
    return null;
  }
  const [integer, fraction = ""] = String(value).split(".");
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) return null;
  const scaled =
    BigInt(integer) * BigInt(100) +
    BigInt((fraction.slice(0, 2) + "00").slice(0, 2));
  if (bounded && scaled > BigInt("999999999999")) return null;
  const canonical = scaled.toString().padStart(3, "0");
  return `${canonical.slice(0, -2)}.${canonical.slice(-2)}`;
}

function cents(value: string) {
  return BigInt(value.replace(".", ""));
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function nullableTimestamp(value: unknown): string | null | undefined {
  return value === null ? null : (timestamp(value) ?? undefined);
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
