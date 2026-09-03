import { err, ok, type PaymentCompleted, type Result } from "../../domain";
import type { AuditClock } from "../audit";
import {
  AuthorizationService,
  type AuthorizationProfileReader,
} from "../authorization";
import type { TransactionalOperationRunner } from "../transactional-operation-runner";

const MAX_MONEY = BigInt("999999999999");

export type RegisterPaymentInput = Readonly<{
  basketId: string;
  paymentMethodId: string;
  amount: string;
  referenceNumber?: string | null;
  comments?: string | null;
  overageReason?: string | null;
  sourceIp?: string | null;
}>;

export type RegisterPaymentCommand = Readonly<{
  actorId: string;
  basketId: string;
  paymentMethodId: string;
  amount: string;
  referenceNumber: string | null;
  comments: string | null;
  overageReason: string | null;
  sourceIp: string | null;
  occurredAt: string;
}>;

export type RegisteredPayment = Readonly<{
  paymentId: string;
  restaurantId: string;
  orderId: string;
  basketId: string;
  paymentMethodId: string;
  recordedById: string;
  amount: string;
  paymentMethodCode: string;
  paymentMethodName: string;
  referenceNumber: string | null;
  comments: string | null;
  recordedAt: string;
  overageAuthorizedById: string | null;
  overageAuthorizedAt: string | null;
  overageReason: string | null;
  basketTotalAmount: string;
  basketPaidAmount: string;
  basketOutstandingBalance: string;
  basketPreviousStatus: "PENDING";
  basketStatus: "PENDING" | "PAID";
  orderPreviousStatus: "DELIVERED";
  orderStatus: "DELIVERED" | "PAID";
  orderPaidAt: string | null;
}>;

export type PaymentRegistrationError = Readonly<{
  kind: "payment-registration-error";
  code:
    | "UNAUTHORIZED"
    | "INVALID_PAYMENT"
    | "NOT_FOUND"
    | "ORDER_NOT_DELIVERED"
    | "BASKET_ALREADY_PAID"
    | "PAYMENT_METHOD_UNAVAILABLE"
    | "OVERAGE_NOT_AUTHORIZED"
    | "OVERAGE_REASON_REQUIRED"
    | "OPERATION_FAILED";
}>;

export interface PaymentRegistrationGateway {
  register(
    command: RegisterPaymentCommand,
  ): Promise<Result<RegisteredPayment, PaymentRegistrationError>>;
}

export class PaymentRegistrationService {
  constructor(
    private readonly profiles: AuthorizationProfileReader,
    private readonly gateway: PaymentRegistrationGateway,
    private readonly clock: AuditClock,
    private readonly operations: TransactionalOperationRunner<PaymentCompleted>,
  ) {}

  async register(
    authenticatedUserId: string,
    input: RegisterPaymentInput,
  ): Promise<Result<RegisteredPayment, PaymentRegistrationError>> {
    if (!isUuid(authenticatedUserId)) return failure("UNAUTHORIZED");

    const authorization = await new AuthorizationService(
      this.profiles,
    ).authorize(authenticatedUserId, "payments.register");
    if (!authorization.ok) return failure("UNAUTHORIZED");

    const normalized = normalize(input);
    if (normalized === null) return failure("INVALID_PAYMENT");
    if (
      normalized.overageReason !== null &&
      !authorization.value.permissionCodes.includes(
        "payments.overage.authorize",
      )
    ) {
      return failure("OVERAGE_NOT_AUTHORIZED");
    }

    let occurredAt: string;
    try {
      const now = this.clock.now();
      if (!Number.isFinite(now.getTime())) return failure("OPERATION_FAILED");
      occurredAt = now.toISOString();
    } catch {
      return failure("OPERATION_FAILED");
    }

    return this.operations.run(async (events) => {
      const result = await this.gateway.register(
        Object.freeze({
          actorId: authorization.value.userId,
          ...normalized,
          occurredAt,
        }),
      );
      if (!result.ok) return result;

      const payment = result.value;
      events.record(
        Object.freeze({
          type: "payment.completed" as const,
          occurredAt: payment.recordedAt,
          payload: Object.freeze({
            paymentId: payment.paymentId,
            restaurantId: payment.restaurantId,
            orderId: payment.orderId,
            basketId: payment.basketId,
            amount: payment.amount,
            basketPaidAmount: payment.basketPaidAmount,
            basketOutstandingBalance: payment.basketOutstandingBalance,
            basketStatus: payment.basketStatus,
            orderStatus: payment.orderStatus,
            recordedAt: payment.recordedAt,
          }),
        }),
      );
      return result;
    });
  }
}

function normalize(input: RegisterPaymentInput) {
  if (
    !isRecord(input) ||
    !isUuid(input.basketId) ||
    !isUuid(input.paymentMethodId)
  ) {
    return null;
  }
  const amount = money(input.amount);
  const referenceNumber = optionalText(input.referenceNumber, 200);
  const comments = optionalText(input.comments, 2_000);
  const overageReason = optionalText(input.overageReason, 1_000);
  const sourceIp = optionalText(input.sourceIp, 64);
  if (
    amount === null ||
    amount === "0.00" ||
    referenceNumber === undefined ||
    comments === undefined ||
    overageReason === undefined ||
    sourceIp === undefined
  ) {
    return null;
  }
  return Object.freeze({
    basketId: input.basketId,
    paymentMethodId: input.paymentMethodId,
    amount,
    referenceNumber,
    comments,
    overageReason,
    sourceIp,
  });
}

function money(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) {
    return null;
  }
  const [integer, fraction = ""] = value.split(".");
  const scaled =
    BigInt(integer) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
  if (scaled > MAX_MONEY) return null;
  const canonical = scaled.toString().padStart(3, "0");
  return `${canonical.slice(0, -2)}.${canonical.slice(-2)}`;
}

function optionalText(
  value: unknown,
  maximumLength: number,
): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maximumLength) return undefined;
  return normalized.length === 0 ? null : normalized;
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

export function paymentRegistrationFailure(
  code: PaymentRegistrationError["code"],
): Result<never, PaymentRegistrationError> {
  return failure(code);
}

export function registeredPaymentResult(payment: RegisteredPayment) {
  return ok(payment);
}

function failure(code: PaymentRegistrationError["code"]) {
  return err(
    Object.freeze({ kind: "payment-registration-error" as const, code }),
  );
}
