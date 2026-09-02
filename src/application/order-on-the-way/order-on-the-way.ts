import { err, ok, type OrderOnTheWay, type Result } from "../../domain";
import type { AuditClock } from "../audit";
import {
  AuthorizationService,
  type AuthorizationProfileReader,
} from "../authorization";
import type { TransactionalOperationRunner } from "../transactional-operation-runner";

export type MarkOrderOnTheWayInput = Readonly<{
  orderId: string;
  sourceIp?: string | null;
}>;

export type MarkOrderOnTheWayCommand = Readonly<{
  actorId: string;
  orderId: string;
  sourceIp: string | null;
  occurredAt: string;
}>;

export type OnTheWayOrder = Readonly<{
  orderId: string;
  restaurantId: string;
  serviceLocationId: string;
  orderNumber: string;
  assignedWaiterId: string;
  previousStatus: "READY";
  status: "ON_THE_WAY";
  collectedById: string;
  readyAt: string;
  onTheWayAt: string;
  updatedAt: string;
}>;

export type OrderOnTheWayError = Readonly<{
  kind: "order-on-the-way-error";
  code:
    | "UNAUTHORIZED"
    | "INVALID_ON_THE_WAY_TRANSITION"
    | "NOT_FOUND"
    | "ORDER_NOT_READY"
    | "OPERATION_FAILED";
}>;

export interface OrderOnTheWayGateway {
  markOnTheWay(
    command: MarkOrderOnTheWayCommand,
  ): Promise<Result<OnTheWayOrder, OrderOnTheWayError>>;
}

export class OrderOnTheWayService {
  constructor(
    private readonly profiles: AuthorizationProfileReader,
    private readonly gateway: OrderOnTheWayGateway,
    private readonly clock: AuditClock,
    private readonly operations: TransactionalOperationRunner<OrderOnTheWay>,
  ) {}

  async markOnTheWay(
    authenticatedUserId: string,
    input: MarkOrderOnTheWayInput,
  ): Promise<Result<OnTheWayOrder, OrderOnTheWayError>> {
    if (!isUuid(authenticatedUserId)) return failure("UNAUTHORIZED");

    const authorization = await new AuthorizationService(
      this.profiles,
    ).authorize(authenticatedUserId, "delivery.on_the_way.mark");
    if (!authorization.ok) return failure("UNAUTHORIZED");

    const normalized = normalize(input);
    if (normalized === null) return failure("INVALID_ON_THE_WAY_TRANSITION");

    let occurredAt: string;
    try {
      const now = this.clock.now();
      if (!Number.isFinite(now.getTime())) return failure("OPERATION_FAILED");
      occurredAt = now.toISOString();
    } catch {
      return failure("OPERATION_FAILED");
    }

    return this.operations.run(async (events) => {
      const result = await this.gateway.markOnTheWay(
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
          type: "order.on-the-way" as const,
          occurredAt: order.onTheWayAt,
          payload: Object.freeze({ ...order }),
        }),
      );
      return result;
    });
  }
}

function normalize(input: MarkOrderOnTheWayInput) {
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

export function orderOnTheWayFailure(
  code: OrderOnTheWayError["code"],
): Result<never, OrderOnTheWayError> {
  return failure(code);
}

export function onTheWayOrderResult(order: OnTheWayOrder) {
  return ok(order);
}

function failure(code: OrderOnTheWayError["code"]) {
  return err(Object.freeze({ kind: "order-on-the-way-error" as const, code }));
}
