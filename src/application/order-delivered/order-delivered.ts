import { err, ok, type OrderDelivered, type Result } from "../../domain";
import type { AuditClock } from "../audit";
import {
  AuthorizationService,
  type AuthorizationProfileReader,
} from "../authorization";
import type { TransactionalOperationRunner } from "../transactional-operation-runner";

export type MarkOrderDeliveredInput = Readonly<{
  orderId: string;
  sourceIp?: string | null;
}>;

export type MarkOrderDeliveredCommand = Readonly<{
  actorId: string;
  orderId: string;
  sourceIp: string | null;
  occurredAt: string;
}>;

export type DeliveredOrder = Readonly<{
  orderId: string;
  restaurantId: string;
  serviceLocationId: string;
  orderNumber: string;
  assignedWaiterId: string;
  previousStatus: "ON_THE_WAY";
  status: "DELIVERED";
  deliveredById: string;
  readyAt: string;
  onTheWayAt: string;
  deliveredAt: string;
  updatedAt: string;
}>;

export type OrderDeliveredError = Readonly<{
  kind: "order-delivered-error";
  code:
    | "UNAUTHORIZED"
    | "INVALID_DELIVERED_TRANSITION"
    | "NOT_FOUND"
    | "ORDER_NOT_ON_THE_WAY"
    | "OPERATION_FAILED";
}>;

export interface OrderDeliveredGateway {
  markDelivered(
    command: MarkOrderDeliveredCommand,
  ): Promise<Result<DeliveredOrder, OrderDeliveredError>>;
}

export class OrderDeliveredService {
  constructor(
    private readonly profiles: AuthorizationProfileReader,
    private readonly gateway: OrderDeliveredGateway,
    private readonly clock: AuditClock,
    private readonly operations: TransactionalOperationRunner<OrderDelivered>,
  ) {}

  async markDelivered(
    authenticatedUserId: string,
    input: MarkOrderDeliveredInput,
  ): Promise<Result<DeliveredOrder, OrderDeliveredError>> {
    if (!isUuid(authenticatedUserId)) return failure("UNAUTHORIZED");

    const authorization = await new AuthorizationService(
      this.profiles,
    ).authorize(authenticatedUserId, "delivery.delivered.mark");
    if (!authorization.ok) return failure("UNAUTHORIZED");

    const normalized = normalize(input);
    if (normalized === null) return failure("INVALID_DELIVERED_TRANSITION");

    let occurredAt: string;
    try {
      const now = this.clock.now();
      if (!Number.isFinite(now.getTime())) return failure("OPERATION_FAILED");
      occurredAt = now.toISOString();
    } catch {
      return failure("OPERATION_FAILED");
    }

    return this.operations.run(async (events) => {
      const result = await this.gateway.markDelivered(
        Object.freeze({
          actorId: authorization.value.userId,
          ...normalized,
          occurredAt,
        }),
      );
      if (!result.ok) return result;

      const order = result.value;
      events.record(
        Object.freeze({
          type: "order.delivered" as const,
          occurredAt: order.deliveredAt,
          payload: Object.freeze({ ...order }),
        }),
      );
      return result;
    });
  }
}

function normalize(input: MarkOrderDeliveredInput) {
  if (!isRecord(input) || !isUuid(input.orderId)) return null;
  const sourceIp = normalizeOptionalText(input.sourceIp, 64);
  if (sourceIp === undefined) return null;
  return Object.freeze({ orderId: input.orderId, sourceIp });
}

function normalizeOptionalText(
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

export function orderDeliveredFailure(
  code: OrderDeliveredError["code"],
): Result<never, OrderDeliveredError> {
  return failure(code);
}

export function deliveredOrderResult(order: DeliveredOrder) {
  return ok(order);
}

function failure(code: OrderDeliveredError["code"]) {
  return err(Object.freeze({ kind: "order-delivered-error" as const, code }));
}
