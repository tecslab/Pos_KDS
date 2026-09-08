import {
  err,
  ok,
  type InventoryAlertChanged,
  type InventoryAlertTransition,
  type OrderConfirmed,
  type Result,
} from "../../domain";
import type { AuditClock } from "../audit";
import {
  AuthorizationService,
  type AuthorizationProfileReader,
} from "../authorization";
import type { TransactionalOperationRunner } from "../transactional-operation-runner";
import { recordInventoryAlertEvents } from "../inventory-alerts";

const MAX_INT = 2_147_483_647;
const MAX_BASKETS = 100;
const MAX_LINES = 1_000;
const MAX_MODIFICATIONS = 100;
const MAX_TEXT_LENGTH = 2_000;

export type ConfirmOrderLineInput = Readonly<{
  clientCorrelationId: string;
  productVersionId: string;
  quantity: number;
  optionIds?: readonly string[];
  removableIngredientIds?: readonly string[];
  observations?: string | null;
}>;

export type ConfirmOrderBasketInput = Readonly<{
  clientCorrelationId: string;
  lines: readonly ConfirmOrderLineInput[];
}>;

export type ConfirmOrderInput = Readonly<{
  serviceLocationId: string;
  notes?: string | null;
  sourceIp?: string | null;
  baskets: readonly ConfirmOrderBasketInput[];
}>;

export type OrderConfirmationCommandLine = Readonly<{
  productVersionId: string;
  quantity: number;
  optionIds: readonly string[];
  removableIngredientIds: readonly string[];
  observations: string | null;
}>;

export type OrderConfirmationCommandBasket = Readonly<{
  clientCorrelationId: string;
  lines: readonly OrderConfirmationCommandLine[];
}>;

export type OrderConfirmationCommand = Readonly<{
  actorId: string;
  serviceLocationId: string;
  notes: string | null;
  sourceIp: string | null;
  occurredAt: string;
  baskets: readonly OrderConfirmationCommandBasket[];
}>;

export type ConfirmedOrderLine = Readonly<{
  id: string;
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
  selectedOptions: readonly ConfirmedOrderModification[];
  removedIngredients: readonly ConfirmedOrderModification[];
  observations: string | null;
}>;

export type ConfirmedOrderModification = Readonly<{
  id: string;
  name: string;
  priceAdjustment: string | null;
}>;

export type ConfirmedOrderBasket = Readonly<{
  id: string;
  status: "PENDING";
  totalAmount: string;
  lines: readonly ConfirmedOrderLine[];
}>;

export type ConfirmedOrder = Readonly<{
  orderId: string;
  restaurantId: string;
  serviceLocationId: string;
  orderNumber: string;
  assignedWaiterId: string;
  status: "PENDING";
  notes: string | null;
  totalAmount: string;
  confirmedAt: string;
  baskets: readonly ConfirmedOrderBasket[];
}>;

export type PersistedOrderConfirmation = ConfirmedOrder &
  Readonly<{
    inventoryAlertTransitions: readonly InventoryAlertTransition[];
  }>;

export type OrderConfirmationError = Readonly<{
  kind: "order-confirmation-error";
  code:
    | "UNAUTHORIZED"
    | "INVALID_DRAFT"
    | "LOCATION_UNAVAILABLE"
    | "STALE_CONFIGURATION"
    | "INSUFFICIENT_INVENTORY"
    | "OPERATION_FAILED";
}>;

export interface OrderConfirmationGateway {
  confirm(
    command: OrderConfirmationCommand,
  ): Promise<
    Result<ConfirmedOrder | PersistedOrderConfirmation, OrderConfirmationError>
  >;
}

export class OrderConfirmationService {
  constructor(
    private readonly profiles: AuthorizationProfileReader,
    private readonly gateway: OrderConfirmationGateway,
    private readonly clock: AuditClock,
    private readonly operations: TransactionalOperationRunner<
      OrderConfirmed | InventoryAlertChanged
    >,
  ) {}

  async confirm(
    authenticatedUserId: string,
    input: ConfirmOrderInput,
  ): Promise<Result<ConfirmedOrder, OrderConfirmationError>> {
    if (!isUuid(authenticatedUserId)) return failure("UNAUTHORIZED");

    const authorization = await new AuthorizationService(
      this.profiles,
    ).authorize(authenticatedUserId, "orders.create");
    if (!authorization.ok) return failure("UNAUTHORIZED");

    const normalized = normalizeDraft(input);
    if (normalized === null) return failure("INVALID_DRAFT");

    let occurredAt: string;
    try {
      const now = this.clock.now();
      if (!Number.isFinite(now.getTime())) return failure("OPERATION_FAILED");
      occurredAt = now.toISOString();
    } catch {
      return failure("OPERATION_FAILED");
    }

    return this.operations.run(async (events) => {
      const result = await this.gateway.confirm(
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
          type: "order.confirmed" as const,
          occurredAt: order.confirmedAt,
          payload: Object.freeze({
            orderId: order.orderId,
            restaurantId: order.restaurantId,
            serviceLocationId: order.serviceLocationId,
            orderNumber: order.orderNumber,
            assignedWaiterId: order.assignedWaiterId,
            status: "PENDING" as const,
            totalAmount: order.totalAmount,
          }),
        }),
      );
      recordInventoryAlertEvents(
        events,
        order.restaurantId,
        inventoryAlertTransitions,
      );
      return confirmedOrderResult(order);
    });
  }
}

function normalizeDraft(input: ConfirmOrderInput) {
  if (
    !isRecord(input) ||
    !isUuid(input.serviceLocationId) ||
    !Array.isArray(input.baskets) ||
    input.baskets.length < 1 ||
    input.baskets.length > MAX_BASKETS
  ) {
    return null;
  }

  const notes = normalizeOptionalText(input.notes);
  const sourceIp = normalizeOptionalText(input.sourceIp, 64);
  if (notes === undefined || sourceIp === undefined) return null;

  const seenBasketIds = new Set<string>();
  const seenLineIds = new Set<string>();
  const baskets: OrderConfirmationCommandBasket[] = [];
  let sourceLineCount = 0;

  for (const basket of input.baskets) {
    if (
      !isRecord(basket) ||
      !isCorrelationId(basket.clientCorrelationId) ||
      seenBasketIds.has(basket.clientCorrelationId) ||
      !Array.isArray(basket.lines)
    ) {
      return null;
    }
    seenBasketIds.add(basket.clientCorrelationId);
    if (basket.lines.length === 0) continue;

    sourceLineCount += basket.lines.length;
    if (sourceLineCount > MAX_LINES) return null;
    const grouped = new Map<string, OrderConfirmationCommandLine>();

    for (const line of basket.lines) {
      const normalizedLine = normalizeLine(line, seenLineIds);
      if (normalizedLine === null) return null;
      const key = lineKey(normalizedLine);
      const current = grouped.get(key);
      const quantity = (current?.quantity ?? 0) + normalizedLine.quantity;
      if (!Number.isSafeInteger(quantity) || quantity > MAX_INT) return null;
      grouped.set(key, Object.freeze({ ...normalizedLine, quantity }));
    }

    baskets.push(
      Object.freeze({
        clientCorrelationId: basket.clientCorrelationId,
        lines: Object.freeze([...grouped.values()]),
      }),
    );
  }

  if (baskets.length === 0) return null;
  return Object.freeze({
    serviceLocationId: input.serviceLocationId,
    notes,
    sourceIp,
    baskets: Object.freeze(baskets),
  });
}

function normalizeLine(
  line: ConfirmOrderLineInput,
  seenLineIds: Set<string>,
): OrderConfirmationCommandLine | null {
  if (
    !isRecord(line) ||
    !isCorrelationId(line.clientCorrelationId) ||
    seenLineIds.has(line.clientCorrelationId) ||
    !isUuid(line.productVersionId) ||
    !Number.isSafeInteger(line.quantity) ||
    line.quantity < 1 ||
    line.quantity > MAX_INT
  ) {
    return null;
  }
  seenLineIds.add(line.clientCorrelationId);

  const optionIds = normalizeIds(line.optionIds);
  const removableIngredientIds = normalizeIds(line.removableIngredientIds);
  const observations = normalizeOptionalText(line.observations);
  if (
    optionIds === null ||
    removableIngredientIds === null ||
    observations === undefined
  ) {
    return null;
  }
  return Object.freeze({
    productVersionId: line.productVersionId,
    quantity: line.quantity,
    optionIds,
    removableIngredientIds,
    observations,
  });
}

function normalizeIds(value: readonly string[] | undefined) {
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
  value: string | null | undefined,
  maximumLength = MAX_TEXT_LENGTH,
): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maximumLength) return undefined;
  return normalized.length === 0 ? null : normalized;
}

function lineKey(line: OrderConfirmationCommandLine) {
  return JSON.stringify([
    line.productVersionId,
    line.optionIds,
    line.removableIngredientIds,
    line.observations,
  ]);
}

function isCorrelationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= 120
  );
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

export function orderConfirmationFailure(
  code: OrderConfirmationError["code"],
): Result<never, OrderConfirmationError> {
  return failure(code);
}

function failure(code: OrderConfirmationError["code"]) {
  return err(
    Object.freeze({
      kind: "order-confirmation-error" as const,
      code,
    }),
  );
}

export function confirmedOrderResult(order: ConfirmedOrder) {
  return ok(order);
}

export function persistedOrderConfirmationResult(
  persisted: PersistedOrderConfirmation,
) {
  return ok(persisted);
}

function withoutInventoryAlertTransitions({
  inventoryAlertTransitions: _inventoryAlertTransitions,
  ...order
}: PersistedOrderConfirmation): ConfirmedOrder {
  void _inventoryAlertTransitions;
  return Object.freeze(order);
}
