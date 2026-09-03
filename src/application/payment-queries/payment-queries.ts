import { err, ok, type Result } from "../../domain";

export const UNPAID_ORDER_STATUSES = Object.freeze([
  "PENDING",
  "READY",
  "ON_THE_WAY",
  "DELIVERED",
] as const);

export type UnpaidOrderStatus = (typeof UNPAID_ORDER_STATUSES)[number];

export type PaymentQueryFilterInput = Readonly<{
  serviceLocationId?: string;
  orderNumber?: string;
}>;

export type PaymentQueryFilters = Readonly<{
  serviceLocationId: string | null;
  orderNumber: string | null;
}>;

export type PendingPaymentServiceLocation = Readonly<{
  id: string;
  name: string;
  type: string;
}>;

export type PendingPaymentWaiter = Readonly<{
  id: string;
  displayName: string;
}>;

export type PaymentHistoryRecorder = Readonly<{
  id: string;
  displayName: string;
}>;

export type PaymentHistoryEntry = Readonly<{
  id: string;
  amount: string;
  paymentMethodId: string;
  paymentMethodCode: string;
  paymentMethodName: string;
  recordedBy: PaymentHistoryRecorder;
  recordedAt: string;
  referenceNumber: string | null;
  comments: string | null;
}>;

export type PendingPaymentBasket = Readonly<{
  id: string;
  status: "PENDING" | "PAID";
  totalAmount: string;
  paidAmount: string;
  outstandingBalance: string;
  createdAt: string;
  paidAt: string | null;
  payments: readonly PaymentHistoryEntry[];
}>;

export type PendingPaymentOrder = Readonly<{
  id: string;
  restaurantId: string;
  orderNumber: string;
  status: UnpaidOrderStatus;
  serviceLocation: PendingPaymentServiceLocation;
  assignedWaiter: PendingPaymentWaiter;
  totalAmount: string;
  paidAmount: string;
  outstandingBalance: string;
  createdAt: string;
  deliveredAt: string | null;
  baskets: readonly PendingPaymentBasket[];
}>;

export interface PaymentQueryReader {
  listUnpaid(
    filters: PaymentQueryFilters,
  ): Promise<readonly PendingPaymentOrder[]>;
  findUnpaidById(orderId: string): Promise<PendingPaymentOrder | null>;
}

export type PaymentQueryError = Readonly<{
  kind: "payment-query-error";
  code:
    "INVALID_FILTERS" | "INVALID_ORDER_ID" | "NOT_FOUND" | "OPERATION_FAILED";
}>;

export class PaymentQueryService {
  constructor(private readonly reader: PaymentQueryReader) {}

  async list(
    input: PaymentQueryFilterInput,
  ): Promise<Result<readonly PendingPaymentOrder[], PaymentQueryError>> {
    const filters = parsePaymentQueryFilters(input);
    if (filters === null) return failure("INVALID_FILTERS");

    try {
      const orders = await this.reader.listUnpaid(filters);
      if (orders.some((order) => !isUnpaidStatus(order.status))) {
        return failure("OPERATION_FAILED");
      }
      return ok(Object.freeze([...orders]));
    } catch {
      return failure("OPERATION_FAILED");
    }
  }

  async detail(
    orderId: string,
  ): Promise<Result<PendingPaymentOrder, PaymentQueryError>> {
    if (!isUuid(orderId)) return failure("INVALID_ORDER_ID");

    try {
      const order = await this.reader.findUnpaidById(orderId);
      if (order === null) return failure("NOT_FOUND");
      if (order.id !== orderId || !isUnpaidStatus(order.status)) {
        return failure("OPERATION_FAILED");
      }
      return ok(order);
    } catch {
      return failure("OPERATION_FAILED");
    }
  }
}

export function parsePaymentQueryFilters(
  input: PaymentQueryFilterInput,
): PaymentQueryFilters | null {
  if (!isRecord(input)) return null;
  const serviceLocationId = optionalUuid(input.serviceLocationId);
  const orderNumber = optionalOrderNumber(input.orderNumber);
  if (serviceLocationId === undefined || orderNumber === undefined) return null;
  return Object.freeze({ serviceLocationId, orderNumber });
}

function optionalUuid(value: unknown): string | null | undefined {
  if (value === undefined) return null;
  return isUuid(value) ? value : undefined;
}

function optionalOrderNumber(value: unknown): string | null | undefined {
  if (value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 100
    ? normalized
    : undefined;
}

function isUnpaidStatus(value: string): value is UnpaidOrderStatus {
  return (UNPAID_ORDER_STATUSES as readonly string[]).includes(value);
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

function failure(code: PaymentQueryError["code"]) {
  return err(Object.freeze({ kind: "payment-query-error" as const, code }));
}
