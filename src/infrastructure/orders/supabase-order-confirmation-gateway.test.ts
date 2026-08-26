import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { OrderConfirmationCommand } from "../../application";
import { SupabaseOrderConfirmationGateway } from "./supabase-order-confirmation-gateway";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const productVersionId = "36000000-0000-4000-8000-000000000002";
const optionId = "37000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const lineId = "43000000-0000-4000-8000-000000000001";

const command: OrderConfirmationCommand = Object.freeze({
  actorId,
  serviceLocationId: locationId,
  notes: null,
  sourceIp: "192.0.2.10",
  occurredAt: "2026-08-25T10:00:00.000Z",
  baskets: Object.freeze([
    Object.freeze({
      clientCorrelationId: "guest-1",
      lines: Object.freeze([
        Object.freeze({
          productVersionId,
          quantity: 2,
          optionIds: Object.freeze([optionId]),
          removableIngredientIds: Object.freeze([]),
          observations: null,
        }),
      ]),
    }),
  ]),
});

function committedRow() {
  return {
    order_id: orderId,
    restaurant_id: restaurantId,
    service_location_id: locationId,
    order_number: "ORD-81",
    assigned_waiter_id: actorId,
    status: "PENDING",
    notes: null,
    total_amount: "10.00",
    confirmed_at: "2026-08-25T10:00:00+00:00",
    baskets: [
      {
        id: basketId,
        status: "PENDING",
        totalAmount: 10,
        lines: [
          {
            id: lineId,
            productVersionId,
            productName: "Taco mixto",
            quantity: 2,
            baseUnitPrice: "4.50",
            finalUnitPrice: 5,
            lineTotal: "10.00",
            taxCode: "IVA",
            taxName: "IVA 15%",
            taxRate: "0.150000",
            priceIncludesTax: true,
            selectedOptions: [
              { id: optionId, name: "Extra queso", priceAdjustment: 0.5 },
            ],
            removedIngredients: [],
            observations: null,
          },
        ],
      },
    ],
  };
}

describe("SupabaseOrderConfirmationGateway", () => {
  it("calls exactly one RPC and strictly maps the canonical committed aggregate", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [committedRow()],
      error: null,
    });
    const gateway = new SupabaseOrderConfirmationGateway({
      rpc,
    } as unknown as SupabaseClient);

    await expect(gateway.confirm(command)).resolves.toEqual({
      ok: true,
      value: {
        orderId,
        restaurantId,
        serviceLocationId: locationId,
        orderNumber: "ORD-81",
        assignedWaiterId: actorId,
        status: "PENDING",
        notes: null,
        totalAmount: "10.00",
        confirmedAt: "2026-08-25T10:00:00.000Z",
        baskets: [
          {
            id: basketId,
            status: "PENDING",
            totalAmount: "10.00",
            lines: [
              expect.objectContaining({
                id: lineId,
                baseUnitPrice: "4.50",
                finalUnitPrice: "5.00",
                lineTotal: "10.00",
                taxRate: "0.150000",
                selectedOptions: [
                  {
                    id: optionId,
                    name: "Extra queso",
                    priceAdjustment: "0.50",
                  },
                ],
              }),
            ],
          },
        ],
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("confirm_order", {
      actor_user_id: actorId,
      target_service_location_id: locationId,
      order_notes: null,
      draft_baskets_text: JSON.stringify(command.baskets),
      audit_occurred_at: "2026-08-25T10:00:00.000Z",
      audit_source_ip: "192.0.2.10",
    });
  });

  it.each([
    ["42501", "denied", "UNAUTHORIZED"],
    ["22023", "invalid", "INVALID_DRAFT"],
    [
      "P0001",
      "ORDER_CONFIRMATION_LOCATION_UNAVAILABLE",
      "LOCATION_UNAVAILABLE",
    ],
    ["P0001", "ORDER_CONFIRMATION_STALE_CONFIGURATION", "STALE_CONFIGURATION"],
    ["23514", "constraint failed", "OPERATION_FAILED"],
  ])("maps safe RPC failure %s to %s", async (code, message, expectedCode) => {
    const gateway = new SupabaseOrderConfirmationGateway({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code, message },
      }),
    } as unknown as SupabaseClient);
    await expect(gateway.confirm(command)).resolves.toEqual({
      ok: false,
      error: { kind: "order-confirmation-error", code: expectedCode },
    });
  });

  it.each([
    { status: "READY" },
    { order_number: "legacy-1" },
    { total_amount: "9.99" },
    {
      baskets: [
        {
          ...committedRow().baskets[0],
          lines: [
            {
              ...committedRow().baskets[0].lines[0],
              selectedOptions: [
                {
                  id: optionId,
                  name: "Extra queso",
                  priceAdjustment: "not-money",
                },
              ],
            },
          ],
        },
      ],
    },
  ])("fails closed for a malformed committed result", async (override) => {
    const gateway = new SupabaseOrderConfirmationGateway({
      rpc: vi.fn().mockResolvedValue({
        data: [{ ...committedRow(), ...override }],
        error: null,
      }),
    } as unknown as SupabaseClient);
    await expect(gateway.confirm(command)).resolves.toEqual({
      ok: false,
      error: { kind: "order-confirmation-error", code: "OPERATION_FAILED" },
    });
  });
});
