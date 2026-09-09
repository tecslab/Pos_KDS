import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { CompleteProductionBatchCommand } from "../../application";
import {
  mapCompletedProductionBatch,
  SupabaseProductionBatchCompletionGateway,
} from "./supabase-production-batch-completion-gateway";

const command: CompleteProductionBatchCommand = {
  actorId: "10000000-0000-4000-8000-000000000001",
  restaurantId: "20000000-0000-4000-8000-000000000001",
  recipeVersionId: "40000000-0000-4000-8000-000000000001",
  producedQuantity: "5.000",
  notes: "Morning prep",
  occurredAt: "2026-09-08T10:00:00.000Z",
  sourceIp: "192.0.2.64",
};

function ingredient(overrides: Record<string, unknown> = {}) {
  return {
    inventoryItemId: "70000000-0000-4000-8000-000000000001",
    inventoryMovementId: "71000000-0000-4000-8000-000000000001",
    quantityConsumed: "2.500",
    unitOfMeasure: "kg",
    previousBalance: "10.000",
    newBalance: "7.500",
    ...overrides,
  };
}

function output(overrides: Record<string, unknown> = {}) {
  return {
    inventoryItemId: "80000000-0000-4000-8000-000000000001",
    inventoryMovementId: "81000000-0000-4000-8000-000000000001",
    quantityProduced: "5.000",
    unitOfMeasure: "unit",
    previousBalance: "1.000",
    newBalance: "6.000",
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    batch_id: "60000000-0000-4000-8000-000000000001",
    restaurant_id: command.restaurantId,
    recipe_id: "30000000-0000-4000-8000-000000000001",
    recipe_version_id: command.recipeVersionId,
    recipe_version_number: 3,
    product_id: "50000000-0000-4000-8000-000000000001",
    status: "COMPLETED",
    produced_quantity: "5.000",
    unit_of_measure: "unit",
    completed_by_id: command.actorId,
    completed_at: "2026-09-08T10:00:00+00:00",
    notes: "Morning prep",
    ingredient_movements: [ingredient()],
    output_movement: output(),
    inventory_alert_transitions: [],
    ...overrides,
  };
}

describe("SupabaseProductionBatchCompletionGateway", () => {
  it("calls the atomic RPC and strictly maps the committed batch", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row()], error: null });
    const gateway = new SupabaseProductionBatchCompletionGateway({
      rpc,
    } as unknown as SupabaseClient);

    await expect(gateway.complete(command)).resolves.toMatchObject({
      ok: true,
      value: {
        restaurantId: command.restaurantId,
        recipeVersionId: command.recipeVersionId,
        recipeVersionNumber: 3,
        status: "COMPLETED",
        producedQuantity: "5.000",
        ingredients: [{ quantityConsumed: "2.500" }],
        output: { quantityProduced: "5.000" },
      },
    });
    expect(rpc).toHaveBeenCalledWith("complete_production_batch", {
      actor_user_id: command.actorId,
      target_restaurant_id: command.restaurantId,
      target_recipe_version_id: command.recipeVersionId,
      produced_quantity_text: "5.000",
      production_notes: "Morning prep",
      audit_occurred_at: command.occurredAt,
      audit_source_ip: "192.0.2.64",
    });
  });

  it.each([
    ["42501", "denied", "UNAUTHORIZED"],
    ["22023", "invalid", "INVALID_BATCH"],
    ["P0001", "PRODUCTION_RESTAURANT_UNAVAILABLE", "RESTAURANT_UNAVAILABLE"],
    [
      "P0001",
      "PRODUCTION_RECIPE_VERSION_UNAVAILABLE",
      "RECIPE_VERSION_UNAVAILABLE",
    ],
    [
      "P0001",
      "PRODUCTION_INVENTORY_ITEM_UNAVAILABLE",
      "INVENTORY_ITEM_UNAVAILABLE",
    ],
    ["P0001", "PRODUCTION_INSUFFICIENT_INVENTORY", "INSUFFICIENT_INVENTORY"],
  ])("maps RPC failure %s/%s safely", async (code, message, expected) => {
    const gateway = new SupabaseProductionBatchCompletionGateway({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code, message } }),
    } as unknown as SupabaseClient);
    await expect(gateway.complete(command)).resolves.toEqual({
      ok: false,
      error: { kind: "production-batch-completion-error", code: expected },
    });
  });

  it.each([
    { batch_id: "bad" },
    { status: "IN_PROGRESS" },
    { recipe_version_number: 0 },
    { produced_quantity: "0" },
    { ingredient_movements: [] },
    { ingredient_movements: [ingredient({ newBalance: "7.499" })] },
    { ingredient_movements: [ingredient(), ingredient()] },
    { output_movement: output({ quantityProduced: "4.000" }) },
    { output_movement: output({ newBalance: "5.999" }) },
    { completed_at: "not-a-date" },
    { notes: "" },
  ])("fails closed for malformed committed output", (override) => {
    expect(mapCompletedProductionBatch(row(override))).toBeNull();
  });
});
