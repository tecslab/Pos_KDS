import { err, ok, type OrderUpdated, type Result } from "../../domain";
import type { AuditClock } from "../audit";
import {
  AuthorizationService,
  type AuthorizationProfileReader,
} from "../authorization";
import type { TransactionalOperationRunner } from "../transactional-operation-runner";

const MAX_OPERATIONS = 1_000;
const MAX_MODIFICATIONS = 100;
const MAX_TEXT_LENGTH = 2_000;
const MAX_INT = 2_147_483_647;

export type AddOrderLineOperationInput = Readonly<{
  kind: "add";
  basketId: string;
  clientCorrelationId: string;
  productVersionId: string;
  quantity: number;
  optionIds?: readonly string[];
  removableIngredientIds?: readonly string[];
  observations?: string | null;
}>;

export type ReplaceOrderLineOperationInput = Readonly<{
  kind: "replace";
  lineId: string;
  expectedCurrentSnapshotId: string;
  quantity: number;
  optionIds?: readonly string[];
  removableIngredientIds?: readonly string[];
  observations?: string | null;
}>;

export type RemoveOrderLineOperationInput = Readonly<{
  kind: "remove";
  lineId: string;
  expectedCurrentSnapshotId: string;
}>;

export type OrderModificationOperationInput =
  | AddOrderLineOperationInput
  | ReplaceOrderLineOperationInput
  | RemoveOrderLineOperationInput;

export type ModifyOrderInput = Readonly<{
  orderId: string;
  expectedUpdatedAt: string;
  sourceIp?: string | null;
  operations: readonly OrderModificationOperationInput[];
}>;

export type OrderModificationCommand = Readonly<{
  actorId: string;
  orderId: string;
  expectedUpdatedAt: string;
  sourceIp: string | null;
  occurredAt: string;
  operations: readonly OrderModificationOperation[];
}>;

export type OrderModificationOperation =
  | Readonly<{
      kind: "add";
      basketId: string;
      clientCorrelationId: string;
      productVersionId: string;
      quantity: number;
      optionIds: readonly string[];
      removableIngredientIds: readonly string[];
      observations: string | null;
    }>
  | Readonly<{
      kind: "replace";
      lineId: string;
      expectedCurrentSnapshotId: string;
      quantity: number;
      optionIds: readonly string[];
      removableIngredientIds: readonly string[];
      observations: string | null;
    }>
  | Readonly<{
      kind: "remove";
      lineId: string;
      expectedCurrentSnapshotId: string;
    }>;

export type ModifiedOrderLine = Readonly<{
  id: string;
  currentSnapshotId: string;
  revisionNumber: number;
  productVersionId: string;
  productName: string;
  quantity: number;
  baseUnitPrice: string;
  finalUnitPrice: string;
  lineTotal: string;
  taxCode: string;
  taxName: string;
  taxRate: string;
  priceIncludesTax: boolean;
  selectedOptions: readonly ModifiedOrderModification[];
  removedIngredients: readonly ModifiedOrderModification[];
  observations: string | null;
}>;

export type ModifiedOrderModification = Readonly<{
  id: string;
  name: string;
  priceAdjustment: string | null;
}>;

export type ModifiedOrderBasket = Readonly<{
  id: string;
  totalAmount: string;
  lines: readonly ModifiedOrderLine[];
}>;

export type ModifiedOrder = Readonly<{
  orderId: string;
  restaurantId: string;
  serviceLocationId: string;
  orderNumber: string;
  assignedWaiterId: string;
  status: "PENDING";
  totalAmount: string;
  updatedAt: string;
  baskets: readonly ModifiedOrderBasket[];
}>;

export type OrderModificationError = Readonly<{
  kind: "order-modification-error";
  code:
    | "UNAUTHORIZED"
    | "INVALID_MODIFICATION"
    | "NOT_FOUND"
    | "ORDER_NOT_PENDING"
    | "STALE_ORDER"
    | "STALE_CONFIGURATION"
    | "OPERATION_FAILED";
}>;

export interface OrderModificationGateway {
  modify(
    command: OrderModificationCommand,
  ): Promise<Result<ModifiedOrder, OrderModificationError>>;
}

export class OrderModificationService {
  constructor(
    private readonly profiles: AuthorizationProfileReader,
    private readonly gateway: OrderModificationGateway,
    private readonly clock: AuditClock,
    private readonly operations: TransactionalOperationRunner<OrderUpdated>,
  ) {}

  async modify(
    authenticatedUserId: string,
    input: ModifyOrderInput,
  ): Promise<Result<ModifiedOrder, OrderModificationError>> {
    if (!isUuid(authenticatedUserId)) return failure("UNAUTHORIZED");
    const authorization = await new AuthorizationService(
      this.profiles,
    ).authorize(authenticatedUserId, "orders.edit");
    if (!authorization.ok) return failure("UNAUTHORIZED");

    const normalized = normalize(input);
    if (normalized === null) return failure("INVALID_MODIFICATION");
    let occurredAt: string;
    try {
      const now = this.clock.now();
      if (!Number.isFinite(now.getTime())) return failure("OPERATION_FAILED");
      occurredAt = now.toISOString();
    } catch {
      return failure("OPERATION_FAILED");
    }

    return this.operations.run(async (events) => {
      const result = await this.gateway.modify(
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
          type: "order.updated" as const,
          occurredAt: order.updatedAt,
          payload: Object.freeze({
            orderId: order.orderId,
            restaurantId: order.restaurantId,
            serviceLocationId: order.serviceLocationId,
            orderNumber: order.orderNumber,
            assignedWaiterId: order.assignedWaiterId,
            status: "PENDING" as const,
            totalAmount: order.totalAmount,
            updatedAt: order.updatedAt,
          }),
        }),
      );
      return result;
    });
  }
}

function normalize(input: ModifyOrderInput) {
  if (
    !isRecord(input) ||
    !isUuid(input.orderId) ||
    !isCanonicalInstant(input.expectedUpdatedAt) ||
    !Array.isArray(input.operations) ||
    input.operations.length < 1 ||
    input.operations.length > MAX_OPERATIONS
  )
    return null;
  const sourceIp = normalizeOptionalText(input.sourceIp, 64);
  if (sourceIp === undefined) return null;

  const lineIds = new Set<string>();
  const correlations = new Set<string>();
  const operations: OrderModificationOperation[] = [];
  for (const value of input.operations) {
    if (!isRecord(value) || typeof value.kind !== "string") return null;
    if (value.kind === "remove") {
      if (
        !hasExactKeys(value, ["kind", "lineId", "expectedCurrentSnapshotId"]) ||
        !isUuid(value.lineId) ||
        !isUuid(value.expectedCurrentSnapshotId) ||
        lineIds.has(value.lineId)
      )
        return null;
      lineIds.add(value.lineId);
      operations.push(
        Object.freeze({
          kind: "remove",
          lineId: value.lineId,
          expectedCurrentSnapshotId: value.expectedCurrentSnapshotId,
        }),
      );
      continue;
    }
    if (value.kind === "replace") {
      if (
        !hasOnlyKeys(value, [
          "kind",
          "lineId",
          "expectedCurrentSnapshotId",
          "quantity",
          "optionIds",
          "removableIngredientIds",
          "observations",
        ]) ||
        !isUuid(value.lineId) ||
        !isUuid(value.expectedCurrentSnapshotId) ||
        lineIds.has(value.lineId)
      )
        return null;
      const configurable = normalizeConfiguration(value);
      if (configurable === null) return null;
      lineIds.add(value.lineId);
      operations.push(
        Object.freeze({
          kind: "replace",
          lineId: value.lineId,
          expectedCurrentSnapshotId: value.expectedCurrentSnapshotId,
          ...configurable,
        }),
      );
      continue;
    }
    if (value.kind === "add") {
      if (
        !hasOnlyKeys(value, [
          "kind",
          "basketId",
          "clientCorrelationId",
          "productVersionId",
          "quantity",
          "optionIds",
          "removableIngredientIds",
          "observations",
        ]) ||
        !isUuid(value.basketId) ||
        !isCorrelationId(value.clientCorrelationId) ||
        correlations.has(value.clientCorrelationId) ||
        !isUuid(value.productVersionId)
      )
        return null;
      const configurable = normalizeConfiguration(value);
      if (configurable === null) return null;
      correlations.add(value.clientCorrelationId);
      operations.push(
        Object.freeze({
          kind: "add",
          basketId: value.basketId,
          clientCorrelationId: value.clientCorrelationId,
          productVersionId: value.productVersionId,
          ...configurable,
        }),
      );
      continue;
    }
    return null;
  }
  return Object.freeze({
    orderId: input.orderId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    sourceIp,
    operations: Object.freeze(operations),
  });
}

function normalizeConfiguration(value: Record<string, unknown>) {
  if (
    !Number.isSafeInteger(value.quantity) ||
    (value.quantity as number) < 1 ||
    (value.quantity as number) > MAX_INT
  )
    return null;
  const optionIds = normalizeIds(value.optionIds);
  const removableIngredientIds = normalizeIds(value.removableIngredientIds);
  const observations = normalizeOptionalText(value.observations);
  if (
    optionIds === null ||
    removableIngredientIds === null ||
    observations === undefined
  )
    return null;
  return {
    quantity: value.quantity as number,
    optionIds,
    removableIngredientIds,
    observations,
  };
}

function normalizeIds(value: unknown) {
  if (value === undefined) return Object.freeze([]) as readonly string[];
  if (!Array.isArray(value) || value.length > MAX_MODIFICATIONS) return null;
  const ids = new Set<string>();
  for (const id of value) {
    if (!isUuid(id) || ids.has(id)) return null;
    ids.add(id);
  }
  return Object.freeze([...ids].sort());
}

function normalizeOptionalText(
  value: unknown,
  maximumLength = MAX_TEXT_LENGTH,
): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maximumLength) return undefined;
  return normalized.length === 0 ? null : normalized;
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isCorrelationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= 120
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  return (
    Object.keys(value).length === expected.length &&
    hasOnlyKeys(value, expected) &&
    expected.every((key) => key in value)
  );
}

export function orderModificationFailure(
  code: OrderModificationError["code"],
): Result<never, OrderModificationError> {
  return failure(code);
}

export function modifiedOrderResult(order: ModifiedOrder) {
  return ok(order);
}

function failure(code: OrderModificationError["code"]) {
  return err(
    Object.freeze({ kind: "order-modification-error" as const, code }),
  );
}
