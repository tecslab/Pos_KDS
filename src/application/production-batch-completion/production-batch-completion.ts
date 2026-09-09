import {
  err,
  ok,
  type InventoryAlertChanged,
  type InventoryAlertTransition,
  type ProductionCompleted,
  type Result,
} from "../../domain";
import type { AuditClock } from "../audit";
import {
  AuthorizationService,
  type AuthorizationProfileReader,
} from "../authorization";
import { recordInventoryAlertEvents } from "../inventory-alerts";
import type { TransactionalOperationRunner } from "../transactional-operation-runner";

const MAX_QUANTITY = BigInt("99999999999999");

export type CompleteProductionBatchInput = Readonly<{
  restaurantId: string;
  recipeVersionId: string;
  producedQuantity: string;
  notes?: string | null;
  sourceIp?: string | null;
}>;

export type CompleteProductionBatchCommand = Readonly<{
  actorId: string;
  restaurantId: string;
  recipeVersionId: string;
  producedQuantity: string;
  notes: string | null;
  occurredAt: string;
  sourceIp: string | null;
}>;

export type ProductionIngredientConsumption = Readonly<{
  inventoryItemId: string;
  inventoryMovementId: string;
  quantityConsumed: string;
  unitOfMeasure: string;
  previousBalance: string;
  newBalance: string;
}>;

export type ProductionOutput = Readonly<{
  inventoryItemId: string;
  inventoryMovementId: string;
  quantityProduced: string;
  unitOfMeasure: string;
  previousBalance: string;
  newBalance: string;
}>;

export type CompletedProductionBatch = Readonly<{
  batchId: string;
  restaurantId: string;
  recipeId: string;
  recipeVersionId: string;
  recipeVersionNumber: number;
  productId: string;
  status: "COMPLETED";
  producedQuantity: string;
  unitOfMeasure: string;
  completedById: string;
  completedAt: string;
  notes: string | null;
  ingredients: readonly ProductionIngredientConsumption[];
  output: ProductionOutput;
}>;

export type PersistedProductionBatchCompletion = CompletedProductionBatch &
  Readonly<{
    inventoryAlertTransitions: readonly InventoryAlertTransition[];
  }>;

export type ProductionBatchCompletionError = Readonly<{
  kind: "production-batch-completion-error";
  code:
    | "UNAUTHORIZED"
    | "INVALID_BATCH"
    | "RESTAURANT_UNAVAILABLE"
    | "RECIPE_VERSION_UNAVAILABLE"
    | "INVENTORY_ITEM_UNAVAILABLE"
    | "INSUFFICIENT_INVENTORY"
    | "OPERATION_FAILED";
}>;

export interface ProductionBatchCompletionGateway {
  complete(
    command: CompleteProductionBatchCommand,
  ): Promise<
    Result<
      CompletedProductionBatch | PersistedProductionBatchCompletion,
      ProductionBatchCompletionError
    >
  >;
}

export class ProductionBatchCompletionService {
  constructor(
    private readonly profiles: AuthorizationProfileReader,
    private readonly gateway: ProductionBatchCompletionGateway,
    private readonly clock: AuditClock,
    private readonly operations: TransactionalOperationRunner<
      ProductionCompleted | InventoryAlertChanged
    >,
  ) {}

  async complete(
    authenticatedUserId: string,
    input: CompleteProductionBatchInput,
  ): Promise<Result<CompletedProductionBatch, ProductionBatchCompletionError>> {
    if (!isUuid(authenticatedUserId)) return failure("UNAUTHORIZED");

    const authorization = await new AuthorizationService(
      this.profiles,
    ).authorize(authenticatedUserId, "production.batch.create");
    if (!authorization.ok) return failure("UNAUTHORIZED");

    const normalized = normalize(input);
    if (normalized === null) return failure("INVALID_BATCH");

    let occurredAt: string;
    try {
      const now = this.clock.now();
      if (!Number.isFinite(now.getTime())) return failure("OPERATION_FAILED");
      occurredAt = now.toISOString();
    } catch {
      return failure("OPERATION_FAILED");
    }

    return this.operations.run(async (events) => {
      const result = await this.gateway.complete(
        Object.freeze({
          actorId: authorization.value.userId,
          ...normalized,
          occurredAt,
        }),
      );
      if (!result.ok) return result;

      const batch =
        "inventoryAlertTransitions" in result.value
          ? withoutInventoryAlertTransitions(result.value)
          : result.value;
      const inventoryAlertTransitions =
        "inventoryAlertTransitions" in result.value
          ? result.value.inventoryAlertTransitions
          : [];

      events.record(
        Object.freeze({
          type: "production.completed" as const,
          occurredAt: batch.completedAt,
          payload: Object.freeze({
            batchId: batch.batchId,
            restaurantId: batch.restaurantId,
            recipeVersionId: batch.recipeVersionId,
            producedQuantity: batch.producedQuantity,
            unitOfMeasure: batch.unitOfMeasure,
            completedAt: batch.completedAt,
            ingredients: batch.ingredients,
            output: batch.output,
          }),
        }),
      );
      recordInventoryAlertEvents(
        events,
        batch.restaurantId,
        inventoryAlertTransitions,
      );
      return completedProductionBatchResult(batch);
    });
  }
}

function normalize(input: CompleteProductionBatchInput) {
  if (
    !isRecord(input) ||
    !isUuid(input.restaurantId) ||
    !isUuid(input.recipeVersionId)
  ) {
    return null;
  }
  const producedQuantity = decimal(input.producedQuantity);
  const notes = optionalText(input.notes, 2_000);
  const sourceIp = optionalText(input.sourceIp, 64);
  if (
    producedQuantity === null ||
    notes === undefined ||
    sourceIp === undefined
  ) {
    return null;
  }
  return Object.freeze({
    restaurantId: input.restaurantId,
    recipeVersionId: input.recipeVersionId,
    producedQuantity,
    notes,
    sourceIp,
  });
}

function decimal(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,11}(?:\.\d{1,3})?$/.test(value)) {
    return null;
  }
  const [integer, fraction = ""] = value.split(".");
  const scaled =
    BigInt(integer) * BigInt(1_000) + BigInt((fraction + "000").slice(0, 3));
  if (scaled === BigInt(0) || scaled > MAX_QUANTITY) return null;
  const canonical = scaled.toString().padStart(4, "0");
  return `${canonical.slice(0, -3)}.${canonical.slice(-3)}`;
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

export function productionBatchCompletionFailure(
  code: ProductionBatchCompletionError["code"],
): Result<never, ProductionBatchCompletionError> {
  return failure(code);
}

export function completedProductionBatchResult(
  batch: CompletedProductionBatch,
) {
  return ok(batch);
}

export function persistedProductionBatchCompletionResult(
  persisted: PersistedProductionBatchCompletion,
) {
  return ok(persisted);
}

function withoutInventoryAlertTransitions({
  inventoryAlertTransitions: _inventoryAlertTransitions,
  ...batch
}: PersistedProductionBatchCompletion): CompletedProductionBatch {
  void _inventoryAlertTransitions;
  return Object.freeze(batch);
}

function failure(code: ProductionBatchCompletionError["code"]) {
  return err(
    Object.freeze({
      kind: "production-batch-completion-error" as const,
      code,
    }),
  );
}
