import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { RegisterInventoryAdjustmentWasteCommand } from "../../application";
import {
  mapRegisteredInventoryAdjustmentWaste,
  SupabaseInventoryAdjustmentWasteRegistrationGateway,
} from "./supabase-inventory-adjustment-waste-registration-gateway";

const command: RegisterInventoryAdjustmentWasteCommand = {
  actorId: "60000000-0000-4000-8000-000000000001",
  restaurantId: "60000000-0000-4000-8000-000000000002",
  inventoryItemId: "60000000-0000-4000-8000-000000000003",
  operation: "ADJUSTMENT",
  quantity: "2.500",
  reason: "Count correction",
  occurredAt: "2026-09-07T10:00:00.000Z",
  sourceIp: "192.0.2.60",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    origin_id: "60000000-0000-4000-8000-000000000004",
    inventory_movement_id: "60000000-0000-4000-8000-000000000005",
    restaurant_id: command.restaurantId,
    inventory_item_id: command.inventoryItemId,
    operation_type: "ADJUSTMENT",
    quantity_delta: "2.500",
    unit_of_measure: "kg",
    reason: "Count correction",
    recorded_by_id: command.actorId,
    recorded_at: "2026-09-07T10:00:00+00:00",
    previous_balance: "5.000",
    new_balance: "7.500",
    ...overrides,
  };
}

describe("SupabaseInventoryAdjustmentWasteRegistrationGateway", () => {
  it("calls the atomic RPC and maps the committed result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row()], error: null });
    const gateway = new SupabaseInventoryAdjustmentWasteRegistrationGateway({
      rpc,
    } as unknown as SupabaseClient);
    await expect(gateway.register(command)).resolves.toMatchObject({
      ok: true,
      value: {
        operation: "ADJUSTMENT",
        quantityDelta: "2.500",
        previousBalance: "5.000",
        newBalance: "7.500",
      },
    });
    expect(rpc).toHaveBeenCalledWith("register_inventory_adjustment_or_waste", {
      actor_user_id: command.actorId,
      target_restaurant_id: command.restaurantId,
      target_inventory_item_id: command.inventoryItemId,
      movement_operation: "ADJUSTMENT",
      quantity_text: "2.500",
      movement_reason: "Count correction",
      audit_occurred_at: command.occurredAt,
      audit_source_ip: "192.0.2.60",
    });
  });

  it.each([
    ["42501", "denied", "UNAUTHORIZED"],
    ["22023", "invalid", "INVALID_MOVEMENT"],
    [
      "P0001",
      "INVENTORY_MOVEMENT_RESTAURANT_UNAVAILABLE",
      "RESTAURANT_UNAVAILABLE",
    ],
    [
      "P0001",
      "INVENTORY_MOVEMENT_ITEM_UNAVAILABLE",
      "INVENTORY_ITEM_UNAVAILABLE",
    ],
    [
      "P0001",
      "INVENTORY_MOVEMENT_NEGATIVE_STOCK_DISALLOWED",
      "NEGATIVE_STOCK_DISALLOWED",
    ],
  ])("maps RPC failure %s/%s safely", async (code, message, expected) => {
    const gateway = new SupabaseInventoryAdjustmentWasteRegistrationGateway({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code, message } }),
    } as unknown as SupabaseClient);
    await expect(gateway.register(command)).resolves.toEqual({
      ok: false,
      error: {
        kind: "inventory-adjustment-waste-registration-error",
        code: expected,
      },
    });
  });

  it.each([
    { origin_id: "bad" },
    { operation_type: "PURCHASE" },
    { quantity_delta: "0" },
    { operation_type: "WASTE", quantity_delta: "1" },
    { new_balance: "7.499" },
    { reason: "" },
    { recorded_at: "not-a-date" },
  ])("fails closed for malformed committed output", (override) => {
    expect(mapRegisteredInventoryAdjustmentWaste(row(override))).toBeNull();
  });
});
