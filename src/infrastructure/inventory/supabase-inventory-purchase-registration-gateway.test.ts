import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { RegisterInventoryPurchaseCommand } from "../../application";
import {
  mapRegisteredInventoryPurchase,
  SupabaseInventoryPurchaseRegistrationGateway,
} from "./supabase-inventory-purchase-registration-gateway";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const categoryId = "50000000-0000-4000-8000-000000000001";
const purchaseId = "51000000-0000-4000-8000-000000000001";
const expenseId = "52000000-0000-4000-8000-000000000001";
const itemId = "53000000-0000-4000-8000-000000000001";
const movementId = "54000000-0000-4000-8000-000000000001";

const command: RegisterInventoryPurchaseCommand = {
  actorId,
  restaurantId,
  expenseCategoryId: categoryId,
  supplierName: "Mercado Central",
  referenceNumber: "FAC-41",
  comments: "Weekly delivery",
  lines: [{ inventoryItemId: itemId, quantity: "2.500", unitPrice: "4.94" }],
  occurredAt: "2026-09-06T10:00:00.000Z",
  sourceIp: "192.0.2.58",
};

function line(overrides: Record<string, unknown> = {}) {
  return {
    inventoryItemId: itemId,
    inventoryMovementId: movementId,
    quantity: "2.500",
    unitOfMeasure: "kg",
    unitPrice: "4.94",
    lineTotal: "12.35",
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    purchase_id: purchaseId,
    restaurant_id: restaurantId,
    expense_category_id: categoryId,
    operating_expense_id: expenseId,
    recorded_by_id: actorId,
    supplier_name_result: "Mercado Central",
    reference_number: "FAC-41",
    comments: "Weekly delivery",
    total_amount: "12.35",
    recorded_at: "2026-09-06T10:00:00+00:00",
    lines: [line()],
    ...overrides,
  };
}

describe("SupabaseInventoryPurchaseRegistrationGateway", () => {
  it("calls the one atomic RPC and strictly maps its result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row()], error: null });
    const gateway = new SupabaseInventoryPurchaseRegistrationGateway({
      rpc,
    } as unknown as SupabaseClient);
    await expect(gateway.register(command)).resolves.toMatchObject({
      ok: true,
      value: {
        purchaseId,
        restaurantId,
        expenseCategoryId: categoryId,
        operatingExpenseId: expenseId,
        totalAmount: "12.35",
        lines: [{ inventoryItemId: itemId, inventoryMovementId: movementId }],
      },
    });
    expect(rpc).toHaveBeenCalledWith("register_inventory_purchase", {
      actor_user_id: actorId,
      target_restaurant_id: restaurantId,
      target_expense_category_id: categoryId,
      supplier_name: "Mercado Central",
      purchase_reference_number: "FAC-41",
      purchase_comments: "Weekly delivery",
      purchase_lines_text: JSON.stringify(command.lines),
      audit_occurred_at: command.occurredAt,
      audit_source_ip: "192.0.2.58",
    });
  });

  it.each([
    ["42501", "denied", "UNAUTHORIZED"],
    ["22023", "invalid", "INVALID_PURCHASE"],
    [
      "P0001",
      "INVENTORY_PURCHASE_RESTAURANT_UNAVAILABLE",
      "RESTAURANT_UNAVAILABLE",
    ],
    [
      "P0001",
      "INVENTORY_PURCHASE_ITEM_UNAVAILABLE",
      "INVENTORY_ITEM_UNAVAILABLE",
    ],
    [
      "P0001",
      "INVENTORY_PURCHASE_CATEGORY_UNAVAILABLE",
      "EXPENSE_CATEGORY_UNAVAILABLE",
    ],
  ])("maps RPC failure %s/%s safely", async (code, message, expected) => {
    const gateway = new SupabaseInventoryPurchaseRegistrationGateway({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code, message } }),
    } as unknown as SupabaseClient);
    await expect(gateway.register(command)).resolves.toEqual({
      ok: false,
      error: { kind: "inventory-purchase-registration-error", code: expected },
    });
  });

  it.each([
    { purchase_id: "bad" },
    { total_amount: "12.34" },
    { total_amount: "0.00", lines: [line({ lineTotal: "0.00" })] },
    { lines: [] },
    { lines: [line({ quantity: "2.600" })] },
    { lines: [line(), line()] },
    { lines: [line({ inventoryMovementId: "bad" })] },
    { recorded_at: "not-a-date" },
    { supplier_name_result: "" },
  ])("fails closed for malformed committed output", (override) => {
    expect(mapRegisteredInventoryPurchase(row(override))).toBeNull();
  });
});
