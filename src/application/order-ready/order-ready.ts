import { err, ok, type OrderReady, type Result } from "../../domain";
import type { AuditClock } from "../audit";
import {
  AuthorizationService,
  type AuthorizationProfileReader,
} from "../authorization";
import type { TransactionalOperationRunner } from "../transactional-operation-runner";

export type MarkOrderReadyInput = Readonly<{
  orderId: string;
  sourceIp?: string | null;
}>;

export type MarkOrderReadyCommand = Readonly<{
  actorId: string;
  orderId: string;
  sourceIp: string | null;
  occurredAt: string;
}>;

export type ReadyOrder = Readonly<{
  orderId: string;
  restaurantId: string;
  serviceLocationId: string;
  orderNumber: string;
  assignedWaiterId: string;
  previousStatus: "PENDING";
  status: "READY";
  markedReadyById: string;
  readyAt: string;
  updatedAt: string;
}>;

export type OrderReadyError = Readonly<{
  kind: "order-ready-error";
  code:
    | "UNAUTHORIZED"
    | "INVALID_READY_TRANSITION"
    | "NOT_FOUND"
    | "ORDER_NOT_PENDING"
    | "OPERATION_FAILED";
}>;

export interface OrderReadyGateway {
  markReady(
    command: MarkOrderReadyCommand,
  ): Promise<Result<ReadyOrder, OrderReadyError>>;
}

export class OrderReadyService {
  constructor(
    private readonly profiles: AuthorizationProfileReader,
    private readonly gateway: OrderReadyGateway,
    private readonly clock: AuditClock,
    private readonly operations: TransactionalOperationRunner<OrderReady>,
  ) {}

  async markReady(
    authenticatedUserId: string,
    input: MarkOrderReadyInput,
  ): Promise<Result<ReadyOrder, OrderReadyError>> {
    if (!isUuid(authenticatedUserId)) return failure("UNAUTHORIZED");

    const authorization = await new AuthorizationService(
      this.profiles,
    ).authorize(authenticatedUserId, "kitchen.ready.mark");
    if (!authorization.ok) return failure("UNAUTHORIZED");

    const normalized = normalize(input);
    if (normalized === null) return failure("INVALID_READY_TRANSITION");

    let occurredAt: string;
    try {
      const now = this.clock.now();
      if (!Number.isFinite(now.getTime())) return failure("OPERATION_FAILED");
      occurredAt = now.toISOString();
    } catch {
      return failure("OPERATION_FAILED");
    }

    return this.operations.run(async (events) => {
      const result = await this.gateway.markReady(
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
          type: "order.ready" as const,
          occurredAt: order.readyAt,
          payload: Object.freeze({ ...order }),
        }),
      );
      return result;
    });
  }
}

function normalize(input: MarkOrderReadyInput) {
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

export function orderReadyFailure(
  code: OrderReadyError["code"],
): Result<never, OrderReadyError> {
  return failure(code);
}

export function readyOrderResult(order: ReadyOrder) {
  return ok(order);
}

function failure(code: OrderReadyError["code"]) {
  return err(Object.freeze({ kind: "order-ready-error" as const, code }));
}
