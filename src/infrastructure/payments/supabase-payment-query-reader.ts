import type { SupabaseClient } from "@supabase/supabase-js";

import {
  UNPAID_ORDER_STATUSES,
  type PaymentHistoryEntry,
  type PaymentQueryFilters,
  type PaymentQueryReader,
  type PendingPaymentBasket,
  type PendingPaymentOrder,
  type UnpaidOrderStatus,
} from "../../application";

const PENDING_PAYMENT_FIELDS = `
  id,
  restaurant_id,
  order_number,
  status,
  total_amount,
  created_at,
  delivered_at,
  paid_at,
  service_location:service_locations!orders_service_location_fkey (
    id,
    restaurant_id,
    name,
    type
  ),
  assigned_waiter:application_users!orders_assigned_waiter_fkey (
    id,
    display_name
  ),
  baskets:customer_baskets (
    id,
    restaurant_id,
    order_id,
    status,
    total_amount,
    created_at,
    paid_at,
    payments (
      id,
      restaurant_id,
      basket_id,
      payment_method_id,
      recorded_by_id,
      amount,
      payment_method_code,
      payment_method_name,
      reference_number,
      comments,
      recorded_at,
      recorded_by:application_users!payments_recorded_by_fkey (
        id,
        display_name
      )
    )
  )
`;

export class PaymentQueryReadError extends Error {
  constructor() {
    super("Pending payments could not be read.");
    this.name = "PaymentQueryReadError";
  }
}

export class SupabasePaymentQueryReader implements PaymentQueryReader {
  constructor(private readonly client: SupabaseClient) {}

  async listUnpaid(
    filters: PaymentQueryFilters,
  ): Promise<readonly PendingPaymentOrder[]> {
    try {
      let query = this.client
        .from("orders")
        .select(PENDING_PAYMENT_FIELDS)
        .in("status", [...UNPAID_ORDER_STATUSES]);
      if (filters.serviceLocationId) {
        query = query.eq("service_location_id", filters.serviceLocationId);
      }
      if (filters.orderNumber) {
        query = query.eq("order_number", filters.orderNumber);
      }

      const { data, error } = await query
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error !== null || !Array.isArray(data)) throw new Error();
      return Object.freeze(data.map(mapPendingPaymentOrderRow));
    } catch {
      throw new PaymentQueryReadError();
    }
  }

  async findUnpaidById(orderId: string): Promise<PendingPaymentOrder | null> {
    try {
      const { data, error } = await this.client
        .from("orders")
        .select(PENDING_PAYMENT_FIELDS)
        .eq("id", orderId)
        .in("status", [...UNPAID_ORDER_STATUSES])
        .maybeSingle();
      if (error !== null) throw new Error();
      return data === null ? null : mapPendingPaymentOrderRow(data);
    } catch {
      throw new PaymentQueryReadError();
    }
  }
}

export function mapPendingPaymentOrderRow(value: unknown): PendingPaymentOrder {
  if (!isRecord(value)) throw new PaymentQueryReadError();
  const location = singleRelation(value.service_location);
  const waiter = singleRelation(value.assigned_waiter);
  if (
    !isUuid(value.id) ||
    !isUuid(value.restaurant_id) ||
    !isNonblank(value.order_number) ||
    !isUnpaidStatus(value.status) ||
    value.paid_at !== null ||
    !location ||
    !isUuid(location.id) ||
    location.restaurant_id !== value.restaurant_id ||
    !isNonblank(location.name) ||
    !isNonblank(location.type) ||
    !waiter ||
    !isUuid(waiter.id) ||
    !isNonblank(waiter.display_name) ||
    !Array.isArray(value.baskets) ||
    value.baskets.length === 0
  ) {
    throw new PaymentQueryReadError();
  }

  const totalAmount = money(value.total_amount, false);
  if (totalAmount === null) throw new PaymentQueryReadError();
  const restaurantId = value.restaurant_id;
  const orderId = value.id;
  const basketIds = new Set<string>();
  const paymentIds = new Set<string>();
  const baskets = value.baskets.map((basket) => {
    const mapped = mapBasket(basket, restaurantId, orderId, paymentIds);
    if (basketIds.has(mapped.id)) throw new PaymentQueryReadError();
    basketIds.add(mapped.id);
    return mapped;
  });
  baskets.sort(compareCreated);

  if (
    sumMoney(baskets.map((basket) => basket.totalAmount)) !== totalAmount ||
    baskets.every((basket) => basket.status === "PAID")
  ) {
    throw new PaymentQueryReadError();
  }
  const paidAmount = sumMoney(baskets.map((basket) => basket.paidAmount));
  const outstandingBalance = sumMoney(
    baskets.map((basket) => basket.outstandingBalance),
  );
  if (outstandingBalance === "0.00") throw new PaymentQueryReadError();

  const deliveredAt = nullableTimestamp(value.delivered_at);
  if (
    (value.status === "DELIVERED" && deliveredAt === null) ||
    (value.status !== "DELIVERED" && deliveredAt !== null)
  ) {
    throw new PaymentQueryReadError();
  }

  return Object.freeze({
    id: orderId,
    restaurantId,
    orderNumber: value.order_number,
    status: value.status,
    serviceLocation: Object.freeze({
      id: location.id,
      name: location.name,
      type: location.type,
    }),
    assignedWaiter: Object.freeze({
      id: waiter.id,
      displayName: waiter.display_name,
    }),
    totalAmount,
    paidAmount,
    outstandingBalance,
    createdAt: timestamp(value.created_at),
    deliveredAt,
    baskets: Object.freeze(baskets),
  });
}

function mapBasket(
  value: unknown,
  restaurantId: string,
  orderId: string,
  paymentIds: Set<string>,
): PendingPaymentBasket {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    value.restaurant_id !== restaurantId ||
    value.order_id !== orderId ||
    (value.status !== "PENDING" && value.status !== "PAID") ||
    !Array.isArray(value.payments)
  ) {
    throw new PaymentQueryReadError();
  }
  const basketId = value.id;
  const totalAmount = money(value.total_amount, false);
  if (totalAmount === null) throw new PaymentQueryReadError();

  const payments = value.payments.map((payment) => {
    const mapped = mapPayment(payment, restaurantId, basketId);
    if (paymentIds.has(mapped.id)) throw new PaymentQueryReadError();
    paymentIds.add(mapped.id);
    return mapped;
  });
  payments.sort(compareRecorded);
  const paidAmount = sumMoney(payments.map((payment) => payment.amount));
  const outstandingBalance = subtractAtZero(totalAmount, paidAmount);
  const paidAt = nullableTimestamp(value.paid_at);
  if (
    (value.status === "PAID" &&
      (outstandingBalance !== "0.00" || paidAt === null)) ||
    (value.status === "PENDING" &&
      (outstandingBalance === "0.00" || paidAt !== null))
  ) {
    throw new PaymentQueryReadError();
  }

  return Object.freeze({
    id: basketId,
    status: value.status,
    totalAmount,
    paidAmount,
    outstandingBalance,
    createdAt: timestamp(value.created_at),
    paidAt,
    payments: Object.freeze(payments),
  });
}

function mapPayment(
  value: unknown,
  restaurantId: string,
  basketId: string,
): PaymentHistoryEntry {
  if (!isRecord(value)) throw new PaymentQueryReadError();
  const recorder = singleRelation(value.recorded_by);
  if (
    !isUuid(value.id) ||
    value.restaurant_id !== restaurantId ||
    value.basket_id !== basketId ||
    !isUuid(value.payment_method_id) ||
    !isUuid(value.recorded_by_id) ||
    !recorder ||
    recorder.id !== value.recorded_by_id ||
    !isNonblank(recorder.display_name) ||
    !isNonblank(value.payment_method_code) ||
    !isNonblank(value.payment_method_name) ||
    !optionalText(value.reference_number, 200) ||
    !optionalText(value.comments, 2_000)
  ) {
    throw new PaymentQueryReadError();
  }
  const amount = money(value.amount, true);
  if (amount === null || amount === "0.00") throw new PaymentQueryReadError();

  return Object.freeze({
    id: value.id,
    amount,
    paymentMethodId: value.payment_method_id,
    paymentMethodCode: value.payment_method_code,
    paymentMethodName: value.payment_method_name,
    recordedBy: Object.freeze({
      id: recorder.id,
      displayName: recorder.display_name,
    }),
    recordedAt: timestamp(value.recorded_at),
    referenceNumber: value.reference_number as string | null,
    comments: value.comments as string | null,
  });
}

function optionalText(value: unknown, maximumLength: number) {
  return (
    value === null ||
    (typeof value === "string" && value.length <= maximumLength)
  );
}

function money(value: unknown, positive: boolean): string | null {
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
  if (scaled > BigInt("999999999999") || (positive && scaled === BigInt(0))) {
    return null;
  }
  return formatCents(scaled);
}

function sumMoney(values: readonly string[]) {
  return formatCents(
    values.reduce((sum, value) => sum + cents(value), BigInt(0)),
  );
}

function subtractAtZero(total: string, paid: string) {
  const difference = cents(total) - cents(paid);
  return formatCents(difference > BigInt(0) ? difference : BigInt(0));
}

function cents(value: string) {
  return BigInt(value.replace(".", ""));
}

function formatCents(value: bigint) {
  const canonical = value.toString().padStart(3, "0");
  return `${canonical.slice(0, -2)}.${canonical.slice(-2)}`;
}

function timestamp(value: unknown) {
  if (typeof value !== "string") throw new PaymentQueryReadError();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new PaymentQueryReadError();
  return new Date(milliseconds).toISOString();
}

function nullableTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}

function compareCreated(
  left: PendingPaymentBasket,
  right: PendingPaymentBasket,
) {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareRecorded(
  left: PaymentHistoryEntry,
  right: PaymentHistoryEntry,
) {
  return (
    left.recordedAt.localeCompare(right.recordedAt) ||
    left.id.localeCompare(right.id)
  );
}

function singleRelation(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) {
    return value[0];
  }
  return null;
}

function isUnpaidStatus(value: unknown): value is UnpaidOrderStatus {
  return (
    typeof value === "string" &&
    (UNPAID_ORDER_STATUSES as readonly string[]).includes(value)
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
