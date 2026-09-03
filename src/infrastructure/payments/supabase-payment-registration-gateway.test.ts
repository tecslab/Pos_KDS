import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { RegisterPaymentCommand } from "../../application";
import { SupabasePaymentRegistrationGateway } from "./supabase-payment-registration-gateway";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const methodId = "43000000-0000-4000-8000-000000000001";
const paymentId = "44000000-0000-4000-8000-000000000001";
const command: RegisterPaymentCommand = {
  actorId,
  basketId,
  paymentMethodId: methodId,
  amount: "5.00",
  referenceNumber: null,
  comments: null,
  overageReason: null,
  sourceIp: null,
  occurredAt: "2026-09-02T10:00:00.000Z",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    payment_id: paymentId,
    restaurant_id: restaurantId,
    order_id: orderId,
    basket_id: basketId,
    payment_method_id: methodId,
    recorded_by_id: actorId,
    amount: "5.00",
    payment_method_code: "cash",
    payment_method_name: "Cash",
    reference_number: null,
    comments: null,
    recorded_at: "2026-09-02T10:00:00+00:00",
    overage_authorized_by_id: null,
    overage_authorized_at: null,
    overage_reason: null,
    basket_total_amount: "10.00",
    basket_paid_amount: "5.00",
    basket_outstanding_balance: "5.00",
    basket_previous_status: "PENDING",
    basket_status: "PENDING",
    order_previous_status: "DELIVERED",
    order_status: "DELIVERED",
    order_paid_at: null,
    ...overrides,
  };
}

describe("SupabasePaymentRegistrationGateway", () => {
  it("calls one RPC and strictly maps a partial payment", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row()], error: null });
    const gateway = new SupabasePaymentRegistrationGateway({
      rpc,
    } as unknown as SupabaseClient);
    const result = await gateway.register(command);
    expect(result).toMatchObject({
      ok: true,
      value: {
        paymentId,
        basketId,
        amount: "5.00",
        basketStatus: "PENDING",
        basketOutstandingBalance: "5.00",
        orderStatus: "DELIVERED",
      },
    });
    expect(rpc).toHaveBeenCalledWith("register_payment", {
      actor_user_id: actorId,
      target_basket_id: basketId,
      target_payment_method_id: methodId,
      payment_amount: "5.00",
      payment_reference_number: null,
      payment_comments: null,
      overage_authorization_reason: null,
      audit_occurred_at: command.occurredAt,
      audit_source_ip: null,
    });
  });

  it("maps exact settlement and self-authorized overage evidence", async () => {
    const recordedAt = "2026-09-02T10:00:00+00:00";
    const gateway = new SupabasePaymentRegistrationGateway({
      rpc: vi.fn().mockResolvedValue({
        data: [
          row({
            amount: "11.00",
            basket_paid_amount: "11.00",
            basket_outstanding_balance: "0.00",
            basket_status: "PAID",
            order_status: "PAID",
            order_paid_at: recordedAt,
            recorded_at: recordedAt,
            overage_authorized_by_id: actorId,
            overage_authorized_at: recordedAt,
            overage_reason: "Approved cash overage",
          }),
        ],
        error: null,
      }),
    } as unknown as SupabaseClient);
    await expect(gateway.register(command)).resolves.toMatchObject({
      ok: true,
      value: {
        basketStatus: "PAID",
        orderStatus: "PAID",
        basketOutstandingBalance: "0.00",
        overageAuthorizedById: actorId,
        overageReason: "Approved cash overage",
      },
    });
  });

  it.each([
    ["42501", "denied", "UNAUTHORIZED"],
    ["42501", "PAYMENT_OVERAGE_UNAUTHORIZED", "OVERAGE_NOT_AUTHORIZED"],
    ["22023", "invalid", "INVALID_PAYMENT"],
    ["P0001", "PAYMENT_BASKET_NOT_FOUND", "NOT_FOUND"],
    ["P0001", "PAYMENT_ORDER_NOT_DELIVERED", "ORDER_NOT_DELIVERED"],
    ["P0001", "PAYMENT_BASKET_ALREADY_PAID", "BASKET_ALREADY_PAID"],
    ["P0001", "PAYMENT_METHOD_UNAVAILABLE", "PAYMENT_METHOD_UNAVAILABLE"],
    ["P0001", "PAYMENT_OVERAGE_REASON_REQUIRED", "OVERAGE_REASON_REQUIRED"],
  ])("maps RPC failure %s/%s safely", async (code, message, expected) => {
    const gateway = new SupabasePaymentRegistrationGateway({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code, message } }),
    } as unknown as SupabaseClient);
    await expect(gateway.register(command)).resolves.toEqual({
      ok: false,
      error: { kind: "payment-registration-error", code: expected },
    });
  });

  it.each([
    { payment_id: "bad" },
    { amount: "0.00" },
    { basket_outstanding_balance: "4.99" },
    { basket_status: "PAID" },
    { order_status: "PAID", order_paid_at: null },
    { overage_authorized_by_id: actorId },
  ])("fails closed for malformed committed output", async (override) => {
    const gateway = new SupabasePaymentRegistrationGateway({
      rpc: vi.fn().mockResolvedValue({ data: [row(override)], error: null }),
    } as unknown as SupabaseClient);
    await expect(gateway.register(command)).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
  });
});
