import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { OrderCancellationCommand } from "../../application";
import { SupabaseOrderCancellationGateway } from "./supabase-order-cancellation-gateway";

const actorId = "10000000-0000-4000-8000-000000000001";
const waiterId = "10000000-0000-4000-8000-000000000002";
const orderId = "41000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const itemId = "45000000-0000-4000-8000-000000000001";
const saleId = "46000000-0000-4000-8000-000000000001";
const rollbackId = "46000000-0000-4000-8000-000000000002";

const command: OrderCancellationCommand = Object.freeze({
  actorId,
  orderId,
  reason: "Customer request",
  sourceIp: "192.0.2.10",
  occurredAt: "2026-08-30T10:00:00.000Z",
});

function committedRow() {
  return {
    order_id: orderId,
    restaurant_id: restaurantId,
    service_location_id: locationId,
    order_number: "ORD-42",
    assigned_waiter_id: waiterId,
    previous_status: "READY",
    status: "CANCELLED",
    total_amount: 12,
    reason: "Customer request",
    cancelled_by_id: actorId,
    cancelled_at: "2026-08-30T10:00:00+00:00",
    updated_at: "2026-08-30T10:00:00+00:00",
    inventory_movements: [
      {
        inventory_movement_id: rollbackId,
        inventory_item_id: itemId,
        type: "ROLLBACK",
        quantity_delta: 2,
        unit_of_measure: "each",
        reversed_movement_id: saleId,
      },
    ],
    inventory_alert_transitions: [],
  };
}

describe("SupabaseOrderCancellationGateway", () => {
  it("calls one RPC and strictly maps the committed cancellation", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [committedRow()], error: null });
    const gateway = new SupabaseOrderCancellationGateway({
      rpc,
    } as unknown as SupabaseClient);
    await expect(gateway.cancel(command)).resolves.toEqual({
      ok: true,
      value: {
        orderId,
        restaurantId,
        serviceLocationId: locationId,
        orderNumber: "ORD-42",
        assignedWaiterId: waiterId,
        previousStatus: "READY",
        status: "CANCELLED",
        totalAmount: "12.00",
        reason: "Customer request",
        cancelledById: actorId,
        cancelledAt: "2026-08-30T10:00:00.000Z",
        updatedAt: "2026-08-30T10:00:00.000Z",
        inventoryMovements: [
          {
            inventoryMovementId: rollbackId,
            inventoryItemId: itemId,
            type: "ROLLBACK",
            quantityDelta: "2.000",
            unitOfMeasure: "each",
            reversedMovementId: saleId,
          },
        ],
        inventoryAlertTransitions: [],
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("cancel_order", {
      actor_user_id: actorId,
      target_order_id: orderId,
      cancellation_reason: "Customer request",
      audit_occurred_at: "2026-08-30T10:00:00.000Z",
      audit_source_ip: "192.0.2.10",
    });
  });

  it.each([
    ["42501", "denied", "UNAUTHORIZED"],
    ["22023", "invalid", "INVALID_CANCELLATION"],
    ["P0001", "ORDER_CANCELLATION_NOT_FOUND", "NOT_FOUND"],
    ["P0001", "ORDER_CANCELLATION_NOT_CANCELLABLE", "ORDER_NOT_CANCELLABLE"],
    [
      "P0001",
      "ORDER_CANCELLATION_INVALID_INVENTORY_PROVENANCE",
      "OPERATION_FAILED",
    ],
  ])(
    "maps RPC failure %s without leaking details",
    async (code, message, expected) => {
      const gateway = new SupabaseOrderCancellationGateway({
        rpc: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code, message } }),
      } as unknown as SupabaseClient);
      await expect(gateway.cancel(command)).resolves.toEqual({
        ok: false,
        error: { kind: "order-cancellation-error", code: expected },
      });
    },
  );

  it.each([
    { status: "READY" },
    { previous_status: "PAID" },
    { reason: "" },
    { cancelled_by_id: "not-a-uuid" },
    { updated_at: "2026-08-30T10:00:01+00:00" },
    {
      inventory_movements: [
        { ...committedRow().inventory_movements[0], quantity_delta: -2 },
      ],
    },
    {
      inventory_movements: [
        {
          ...committedRow().inventory_movements[0],
          reversed_movement_id: null,
        },
      ],
    },
  ])("fails closed for malformed committed data", async (override) => {
    const gateway = new SupabaseOrderCancellationGateway({
      rpc: vi.fn().mockResolvedValue({
        data: [{ ...committedRow(), ...override }],
        error: null,
      }),
    } as unknown as SupabaseClient);
    await expect(gateway.cancel(command)).resolves.toEqual({
      ok: false,
      error: { kind: "order-cancellation-error", code: "OPERATION_FAILED" },
    });
  });
});
