import type { SupabaseClient } from "@supabase/supabase-js";

import {
  persistedProductionBatchCompletionResult,
  productionBatchCompletionFailure,
  type CompleteProductionBatchCommand,
  type CompletedProductionBatch,
  type ProductionBatchCompletionGateway,
  type ProductionIngredientConsumption,
  type ProductionOutput,
} from "../../application";
import { mapInventoryAlertTransitions } from "../inventory";

export class SupabaseProductionBatchCompletionGateway implements ProductionBatchCompletionGateway {
  constructor(private readonly client: SupabaseClient) {}

  async complete(command: CompleteProductionBatchCommand) {
    try {
      const { data, error } = await this.client.rpc(
        "complete_production_batch",
        {
          actor_user_id: command.actorId,
          target_restaurant_id: command.restaurantId,
          target_recipe_version_id: command.recipeVersionId,
          produced_quantity_text: command.producedQuantity,
          production_notes: command.notes,
          audit_occurred_at: command.occurredAt,
          audit_source_ip: command.sourceIp,
        },
      );
      if (error) return mapFailure(error);
      if (!Array.isArray(data) || data.length !== 1) {
        return productionBatchCompletionFailure("OPERATION_FAILED");
      }

      const batch = mapCompletedProductionBatch(data[0]);
      const inventoryAlertTransitions = mapInventoryAlertTransitions(
        isRecord(data[0]) ? data[0].inventory_alert_transitions : null,
      );
      return batch === null || inventoryAlertTransitions === null
        ? productionBatchCompletionFailure("OPERATION_FAILED")
        : persistedProductionBatchCompletionResult(
            Object.freeze({ ...batch, inventoryAlertTransitions }),
          );
    } catch {
      return productionBatchCompletionFailure("OPERATION_FAILED");
    }
  }
}

function mapFailure(error: unknown) {
  if (!isRecord(error)) {
    return productionBatchCompletionFailure("OPERATION_FAILED");
  }
  if (error.code === "42501") {
    return productionBatchCompletionFailure("UNAUTHORIZED");
  }
  if (error.code === "22023") {
    return productionBatchCompletionFailure("INVALID_BATCH");
  }
  if (typeof error.message === "string") {
    if (error.message.includes("PRODUCTION_RESTAURANT_UNAVAILABLE")) {
      return productionBatchCompletionFailure("RESTAURANT_UNAVAILABLE");
    }
    if (error.message.includes("PRODUCTION_RECIPE_VERSION_UNAVAILABLE")) {
      return productionBatchCompletionFailure("RECIPE_VERSION_UNAVAILABLE");
    }
    if (error.message.includes("PRODUCTION_INVENTORY_ITEM_UNAVAILABLE")) {
      return productionBatchCompletionFailure("INVENTORY_ITEM_UNAVAILABLE");
    }
    if (
      error.message.includes("PRODUCTION_INSUFFICIENT_INVENTORY") ||
      error.message.includes(
        "inventory movement would produce a negative balance",
      )
    ) {
      return productionBatchCompletionFailure("INSUFFICIENT_INVENTORY");
    }
  }
  return productionBatchCompletionFailure("OPERATION_FAILED");
}

export function mapCompletedProductionBatch(
  value: unknown,
): CompletedProductionBatch | null {
  if (
    !isRecord(value) ||
    !isUuid(value.batch_id) ||
    !isUuid(value.restaurant_id) ||
    !isUuid(value.recipe_id) ||
    !isUuid(value.recipe_version_id) ||
    !isUuid(value.product_id) ||
    !isUuid(value.completed_by_id) ||
    value.status !== "COMPLETED" ||
    !nullableText(value.notes) ||
    !Number.isInteger(value.recipe_version_number) ||
    (value.recipe_version_number as number) < 1 ||
    !isNonblank(value.unit_of_measure)
  ) {
    return null;
  }

  const producedQuantity = decimal(value.produced_quantity);
  const completedAt = timestamp(value.completed_at);
  const ingredients = mapIngredients(value.ingredient_movements);
  const output = mapOutput(value.output_movement);
  if (
    producedQuantity === null ||
    producedQuantity === "0.000" ||
    completedAt === null ||
    ingredients === null ||
    output === null ||
    output.quantityProduced !== producedQuantity ||
    output.unitOfMeasure !== value.unit_of_measure ||
    ingredients.some(
      (ingredient) =>
        ingredient.inventoryItemId === output.inventoryItemId ||
        ingredient.inventoryMovementId === output.inventoryMovementId,
    )
  ) {
    return null;
  }

  return Object.freeze({
    batchId: value.batch_id,
    restaurantId: value.restaurant_id,
    recipeId: value.recipe_id,
    recipeVersionId: value.recipe_version_id,
    recipeVersionNumber: value.recipe_version_number as number,
    productId: value.product_id,
    status: "COMPLETED" as const,
    producedQuantity,
    unitOfMeasure: value.unit_of_measure,
    completedById: value.completed_by_id,
    completedAt,
    notes: value.notes,
    ingredients,
    output,
  });
}

function mapIngredients(
  value: unknown,
): readonly ProductionIngredientConsumption[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return null;
  }
  const itemIds = new Set<string>();
  const movementIds = new Set<string>();
  const ingredients: ProductionIngredientConsumption[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !isUuid(candidate.inventoryItemId) ||
      !isUuid(candidate.inventoryMovementId) ||
      !isNonblank(candidate.unitOfMeasure) ||
      itemIds.has(candidate.inventoryItemId) ||
      movementIds.has(candidate.inventoryMovementId)
    ) {
      return null;
    }
    const quantityConsumed = decimal(candidate.quantityConsumed);
    const previousBalance = decimal(candidate.previousBalance, true);
    const newBalance = decimal(candidate.newBalance, true);
    if (
      quantityConsumed === null ||
      quantityConsumed === "0.000" ||
      previousBalance === null ||
      newBalance === null ||
      scaledInteger(previousBalance) - scaledInteger(quantityConsumed) !==
        scaledInteger(newBalance)
    ) {
      return null;
    }
    itemIds.add(candidate.inventoryItemId);
    movementIds.add(candidate.inventoryMovementId);
    ingredients.push(
      Object.freeze({
        inventoryItemId: candidate.inventoryItemId,
        inventoryMovementId: candidate.inventoryMovementId,
        quantityConsumed,
        unitOfMeasure: candidate.unitOfMeasure,
        previousBalance,
        newBalance,
      }),
    );
  }
  ingredients.sort((left, right) =>
    left.inventoryItemId.localeCompare(right.inventoryItemId),
  );
  return Object.freeze(ingredients);
}

function mapOutput(value: unknown): ProductionOutput | null {
  if (
    !isRecord(value) ||
    !isUuid(value.inventoryItemId) ||
    !isUuid(value.inventoryMovementId) ||
    !isNonblank(value.unitOfMeasure)
  ) {
    return null;
  }
  const quantityProduced = decimal(value.quantityProduced);
  const previousBalance = decimal(value.previousBalance, true);
  const newBalance = decimal(value.newBalance, true);
  if (
    quantityProduced === null ||
    quantityProduced === "0.000" ||
    previousBalance === null ||
    newBalance === null ||
    scaledInteger(previousBalance) + scaledInteger(quantityProduced) !==
      scaledInteger(newBalance)
  ) {
    return null;
  }
  return Object.freeze({
    inventoryItemId: value.inventoryItemId,
    inventoryMovementId: value.inventoryMovementId,
    quantityProduced,
    unitOfMeasure: value.unitOfMeasure,
    previousBalance,
    newBalance,
  });
}

function decimal(value: unknown, signed = false) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !new RegExp(signed ? "^-?\\d+(?:\\.\\d+)?$" : "^\\d+(?:\\.\\d+)?$").test(
      String(value),
    )
  ) {
    return null;
  }
  const [integer, fraction = ""] = String(value).split(".");
  if (fraction.length > 3 && /[1-9]/.test(fraction.slice(3))) return null;
  const negative = integer.startsWith("-");
  const absoluteInteger = negative ? integer.slice(1) : integer;
  const scaled =
    BigInt(absoluteInteger) * BigInt(1_000) +
    BigInt((fraction + "000").slice(0, 3));
  const canonical = scaled.toString().padStart(4, "0");
  return `${negative && scaled !== BigInt(0) ? "-" : ""}${canonical.slice(0, -3)}.${canonical.slice(-3)}`;
}

function scaledInteger(value: string) {
  return BigInt(value.replace(".", ""));
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function nullableText(value: unknown): value is string | null {
  return (
    value === null || (typeof value === "string" && value.trim().length > 0)
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
