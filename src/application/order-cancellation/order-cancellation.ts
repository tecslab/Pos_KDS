import {
  err,
  ok,
  type InventoryAlertChanged,
  type InventoryAlertTransition,
  type InventoryReconciledMovement,
  type OrderCancelled,
  type Result,
} from "../../domain";
import { recordInventoryAlertEvents } from "../inventory-alerts";
import type { AuditClock } from "../audit";
import {
  AuthorizationService,
  type AuthorizationProfileReader,
} from "../authorization";
import type { TransactionalOperationRunner } from "../transactional-operation-runner";

const MAX_REASON_LENGTH = 2_000;

export type CancelOrderInput = Readonly<{
  orderId: string;
  reason: string;
  sourceIp?: string | null;
}>;

export type OrderCancellationCommand = Readonly<{
  actorId: string;
  orderId: string;
  reason: string;
  sourceIp: string | null;
  occurredAt: string;
}>;

export type CancelledOrder = Readonly<{
  orderId: string;
  restaurantId: string;
  serviceLocationId: string;
  orderNumber: string;
  assignedWaiterId: string;
  previousStatus: "PENDING" | "READY";
  status: "CANCELLED";
  totalAmount: string;
  reason: string;
  cancelledById: string;
  cancelledAt: string;
  updatedAt: string;
  inventoryMovements: readonly InventoryReconciledMovement[];
}>;

export type PersistedOrderCancellation = CancelledOrder &
  Readonly<{
    inventoryAlertTransitions: readonly InventoryAlertTransition[];
  }>;

export type OrderCancellationError = Readonly<{
  kind: "order-cancellation-error";
  code:
    | "UNAUTHORIZED"
    | "INVALID_CANCELLATION"
    | "NOT_FOUND"
    | "ORDER_NOT_CANCELLABLE"
    | "OPERATION_FAILED";
}>;

export interface OrderCancellationGateway {
  cancel(
    command: OrderCancellationCommand,
  ): Promise<
    Result<CancelledOrder | PersistedOrderCancellation, OrderCancellationError>
  >;
}

export class OrderCancellationService {
  constructor(
    private readonly profiles: AuthorizationProfileReader,
    private readonly gateway: OrderCancellationGateway,
    private readonly clock: AuditClock,
    private readonly operations: TransactionalOperationRunner<
      OrderCancelled | InventoryAlertChanged
    >,
  ) {}

  async cancel(
    authenticatedUserId: string,
    input: CancelOrderInput,
  ): Promise<Result<CancelledOrder, OrderCancellationError>> {
    if (!isUuid(authenticatedUserId)) return failure("UNAUTHORIZED");

    const authorization = await new AuthorizationService(
      this.profiles,
    ).authorize(authenticatedUserId, "orders.cancel");
    if (!authorization.ok) return failure("UNAUTHORIZED");

    const normalized = normalize(input);
    if (normalized === null) return failure("INVALID_CANCELLATION");

    let occurredAt: string;
    try {
      const now = this.clock.now();
      if (!Number.isFinite(now.getTime())) return failure("OPERATION_FAILED");
      occurredAt = now.toISOString();
    } catch {
      return failure("OPERATION_FAILED");
    }

    return this.operations.run(async (events) => {
      const result = await this.gateway.cancel(
        Object.freeze({
          actorId: authorization.value.userId,
          ...normalized,
          occurredAt,
        }),
      );
      if (!result.ok) return result;

      const order =
        "inventoryAlertTransitions" in result.value
          ? withoutInventoryAlertTransitions(result.value)
          : result.value;
      const inventoryAlertTransitions =
        "inventoryAlertTransitions" in result.value
          ? result.value.inventoryAlertTransitions
          : [];
      events.record(
        Object.freeze({
          type: "order.cancelled" as const,
          occurredAt: order.cancelledAt,
          payload: Object.freeze({
            orderId: order.orderId,
            restaurantId: order.restaurantId,
            serviceLocationId: order.serviceLocationId,
            orderNumber: order.orderNumber,
            assignedWaiterId: order.assignedWaiterId,
            previousStatus: order.previousStatus,
            status: "CANCELLED" as const,
            totalAmount: order.totalAmount,
            cancelledById: order.cancelledById,
            reason: order.reason,
            cancelledAt: order.cancelledAt,
            updatedAt: order.updatedAt,
          }),
        }),
      );
      recordInventoryAlertEvents(
        events,
        order.restaurantId,
        inventoryAlertTransitions,
      );
      return cancelledOrderResult(order);
    });
  }
}

function normalize(input: CancelOrderInput) {
  if (!isRecord(input) || !isUuid(input.orderId)) return null;
  const reason = normalizeRequiredText(input.reason, MAX_REASON_LENGTH);
  const sourceIp = normalizeOptionalText(input.sourceIp, 64);
  if (reason === null || sourceIp === undefined) return null;
  return Object.freeze({ orderId: input.orderId, reason, sourceIp });
}

function normalizeRequiredText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 && normalized.length <= maximumLength
    ? normalized
    : null;
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

export function orderCancellationFailure(
  code: OrderCancellationError["code"],
): Result<never, OrderCancellationError> {
  return failure(code);
}

export function cancelledOrderResult(order: CancelledOrder) {
  return ok(order);
}

export function persistedOrderCancellationResult(
  persisted: PersistedOrderCancellation,
) {
  return ok(persisted);
}

function withoutInventoryAlertTransitions({
  inventoryAlertTransitions: _inventoryAlertTransitions,
  ...order
}: PersistedOrderCancellation): CancelledOrder {
  void _inventoryAlertTransitions;
  return Object.freeze(order);
}

function failure(code: OrderCancellationError["code"]) {
  return err(
    Object.freeze({ kind: "order-cancellation-error" as const, code }),
  );
}
