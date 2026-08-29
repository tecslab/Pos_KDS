import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { OrderModificationCommand } from "../../application";
import { SupabaseOrderModificationGateway } from "./supabase-order-modification-gateway";

const actorId = "10000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const lineId = "43000000-0000-4000-8000-000000000001";
const snapshotId = "44000000-0000-4000-8000-000000000001";
const inventoryItemId = "45000000-0000-4000-8000-000000000001";
const movementId = "46000000-0000-4000-8000-000000000001";

const command: OrderModificationCommand = Object.freeze({
  actorId,
  orderId,
  expectedUpdatedAt: "2026-08-28T09:00:00.000Z",
  occurredAt: "2026-08-28T10:00:00.000Z",
  sourceIp: null,
  operations: Object.freeze([
    { kind: "remove" as const, lineId, expectedCurrentSnapshotId: snapshotId },
  ]),
});

function row() {
  return {
    order_id: orderId,
    restaurant_id: restaurantId,
    service_location_id: "31000000-0000-4000-8000-000000000001",
    order_number: "ORD-42",
    assigned_waiter_id: actorId,
    status: "PENDING",
    total_amount: "10.00",
    updated_at: "2026-08-28T10:00:00+00:00",
    inventory_movements: [
      {
        inventory_movement_id: movementId,
        inventory_item_id: inventoryItemId,
        type: "SALE",
        quantity_delta: "-2.000",
        unit_of_measure: "unit",
        reversed_movement_id: null as string | null,
      },
    ],
    baskets: [
      {
        id: basketId,
        restaurantId,
        totalAmount: "10.00",
        lines: [
          {
            id: lineId,
            currentSnapshotId: snapshotId,
            revisionNumber: 2,
            productVersionId: "36000000-0000-4000-8000-000000000002",
            productName: "Taco",
            quantity: 2,
            baseUnitPrice: "5.00",
            finalUnitPrice: "5.00",
            lineTotal: "10.00",
            taxCode: "IVA",
            taxName: "IVA 15%",
            taxRate: "0.150000",
            priceIncludesTax: true,
            selectedOptions: [],
            removedIngredients: [],
            observations: null,
          },
        ],
      },
    ],
  };
}

describe("SupabaseOrderModificationGateway", () => {
  it("calls one atomic RPC and strictly maps the returned active aggregate", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row()], error: null });
    await expect(
      new SupabaseOrderModificationGateway({
        rpc,
      } as unknown as SupabaseClient).modify(command),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        order: {
          orderId,
          totalAmount: "10.00",
          updatedAt: "2026-08-28T10:00:00.000Z",
        },
        inventoryMovements: [
          {
            inventoryMovementId: movementId,
            inventoryItemId,
            type: "SALE",
            quantityDelta: "-2.000",
            unitOfMeasure: "unit",
            reversedMovementId: null,
          },
        ],
      },
    });
    expect(rpc).toHaveBeenCalledWith("modify_pending_order", {
      actor_user_id: actorId,
      target_order_id: orderId,
      expected_order_updated_at: command.expectedUpdatedAt,
      operations_text: JSON.stringify(command.operations),
      audit_occurred_at: command.occurredAt,
      audit_source_ip: null,
    });
  });

  it.each([
    ["42501", "denied", "UNAUTHORIZED"],
    ["22023", "invalid", "INVALID_MODIFICATION"],
    ["P0001", "ORDER_MODIFICATION_NOT_FOUND", "NOT_FOUND"],
    ["P0001", "ORDER_MODIFICATION_NOT_PENDING", "ORDER_NOT_PENDING"],
    ["P0001", "ORDER_MODIFICATION_STALE_ORDER", "STALE_ORDER"],
    ["P0001", "ORDER_MODIFICATION_STALE_CONFIGURATION", "STALE_CONFIGURATION"],
    [
      "P0001",
      "ORDER_MODIFICATION_INSUFFICIENT_INVENTORY",
      "INSUFFICIENT_INVENTORY",
    ],
  ])(
    "maps %s persistence errors without leaking details",
    async (code, message, expected) => {
      const rpc = vi
        .fn()
        .mockResolvedValue({ data: null, error: { code, message } });
      await expect(
        new SupabaseOrderModificationGateway({
          rpc,
        } as unknown as SupabaseClient).modify(command),
      ).resolves.toMatchObject({ ok: false, error: { code: expected } });
    },
  );

  it("fails closed for a cross-restaurant or inconsistent returned aggregate", async () => {
    const invalid = row();
    invalid.baskets[0]!.restaurantId = "30000000-0000-4000-8000-000000000099";
    const rpc = vi.fn().mockResolvedValue({ data: [invalid], error: null });
    await expect(
      new SupabaseOrderModificationGateway({
        rpc,
      } as unknown as SupabaseClient).modify(command),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
  });

  it.each([
    [{ type: "SALE", quantity_delta: "2.000", reversed_movement_id: null }],
    [{ type: "ROLLBACK", quantity_delta: "1.000", reversed_movement_id: null }],
    [
      {
        type: "ROLLBACK",
        quantity_delta: "-1.000",
        reversed_movement_id: movementId,
      },
    ],
  ])("fails closed for malformed movement summaries", async (changes) => {
    const invalid = row();
    invalid.inventory_movements[0] = {
      ...invalid.inventory_movements[0]!,
      ...changes,
    };
    const rpc = vi.fn().mockResolvedValue({ data: [invalid], error: null });
    await expect(
      new SupabaseOrderModificationGateway({
        rpc,
      } as unknown as SupabaseClient).modify(command),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
  });
});
