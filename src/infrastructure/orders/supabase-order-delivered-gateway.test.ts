import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { MarkOrderDeliveredCommand } from "../../application";
import { SupabaseOrderDeliveredGateway } from "./supabase-order-delivered-gateway";

const actorId = "10000000-0000-4000-8000-000000000001";
const waiterId = "10000000-0000-4000-8000-000000000002";
const orderId = "41000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const command: MarkOrderDeliveredCommand = {
  actorId,
  orderId,
  sourceIp: null,
  occurredAt: "2026-09-01T10:05:00.000Z",
};

function row() {
  return {
    order_id: orderId,
    restaurant_id: restaurantId,
    service_location_id: locationId,
    order_number: "ORD-42",
    assigned_waiter_id: waiterId,
    previous_status: "ON_THE_WAY",
    status: "DELIVERED",
    total_amount: 12,
    outstanding_balance: 8,
    payment_status: "PARTIALLY_PAID",
    base_unit_price: 6,
    delivered_by_id: actorId,
    ready_at: "2026-09-01T09:55:00+00:00",
    on_the_way_at: "2026-09-01T10:00:00+00:00",
    delivered_at: "2026-09-01T10:05:00+00:00",
    updated_at: "2026-09-01T10:05:00+00:00",
  };
}

describe("SupabaseOrderDeliveredGateway", () => {
  it("calls one RPC and strictly maps the committed transition", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row()], error: null });
    const gateway = new SupabaseOrderDeliveredGateway({
      rpc,
    } as unknown as SupabaseClient);
    const result = await gateway.markDelivered(command);
    expect(result).toEqual({
      ok: true,
      value: {
        orderId,
        restaurantId,
        serviceLocationId: locationId,
        orderNumber: "ORD-42",
        assignedWaiterId: waiterId,
        previousStatus: "ON_THE_WAY",
        status: "DELIVERED",
        deliveredById: actorId,
        readyAt: "2026-09-01T09:55:00.000Z",
        onTheWayAt: "2026-09-01T10:00:00.000Z",
        deliveredAt: "2026-09-01T10:05:00.000Z",
        updatedAt: "2026-09-01T10:05:00.000Z",
      },
    });
    expect(rpc).toHaveBeenCalledWith("mark_order_delivered", {
      actor_user_id: actorId,
      target_order_id: orderId,
      audit_occurred_at: command.occurredAt,
      audit_source_ip: null,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(
      /total|price|balance|payment|amount/i,
    );
  });

  it.each([
    ["42501", "denied", "UNAUTHORIZED"],
    ["22023", "invalid", "INVALID_DELIVERED_TRANSITION"],
    ["P0001", "ORDER_DELIVERED_NOT_FOUND", "NOT_FOUND"],
    ["P0001", "ORDER_DELIVERED_NOT_ON_THE_WAY", "ORDER_NOT_ON_THE_WAY"],
  ])("maps RPC failure %s safely", async (code, message, expected) => {
    const gateway = new SupabaseOrderDeliveredGateway({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code, message } }),
    } as unknown as SupabaseClient);
    await expect(gateway.markDelivered(command)).resolves.toEqual({
      ok: false,
      error: { kind: "order-delivered-error", code: expected },
    });
  });

  it.each([
    { status: "ON_THE_WAY" },
    { previous_status: "READY" },
    { delivered_by_id: "invalid" },
    { delivered_at: "2026-09-01T10:05:01+00:00" },
    { on_the_way_at: "2026-09-01T10:05:01+00:00" },
    { ready_at: "2026-09-01T10:00:01+00:00" },
  ])("fails closed for malformed committed output", async (override) => {
    const gateway = new SupabaseOrderDeliveredGateway({
      rpc: vi
        .fn()
        .mockResolvedValue({ data: [{ ...row(), ...override }], error: null }),
    } as unknown as SupabaseClient);
    await expect(gateway.markDelivered(command)).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
  });
});
