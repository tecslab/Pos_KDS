import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  mapPendingPaymentOrderRow,
  PaymentQueryReadError,
  SupabasePaymentQueryReader,
} from "./supabase-payment-query-reader";

const restaurantId = "30000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const waiterId = "10000000-0000-4000-8000-000000000002";
const basketId = "42000000-0000-4000-8000-000000000001";
const paidBasketId = "42000000-0000-4000-8000-000000000002";
const methodId = "32000000-0000-4000-8000-000000000001";

function payment(
  id: string,
  ownerBasketId: string,
  amount: string,
  recordedAt: string,
) {
  return {
    id,
    restaurant_id: restaurantId,
    basket_id: ownerBasketId,
    payment_method_id: methodId,
    recorded_by_id: waiterId,
    amount,
    payment_method_code: "cash",
    payment_method_name: "Cash",
    reference_number: "REF-1",
    comments: "Payment comment",
    recorded_at: recordedAt,
    recorded_by: { id: waiterId, display_name: "Ana" },
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    restaurant_id: restaurantId,
    order_number: "ORD-42",
    status: "DELIVERED",
    total_amount: "20.00",
    created_at: "2026-09-03T09:00:00+00:00",
    delivered_at: "2026-09-03T10:00:00+00:00",
    paid_at: null,
    service_location: {
      id: locationId,
      restaurant_id: restaurantId,
      name: "Table 1",
      type: "TABLE",
    },
    assigned_waiter: { id: waiterId, display_name: "Ana" },
    baskets: [
      {
        id: paidBasketId,
        restaurant_id: restaurantId,
        order_id: orderId,
        status: "PAID",
        total_amount: "10.00",
        created_at: "2026-09-03T09:00:02+00:00",
        paid_at: "2026-09-03T10:02:00+00:00",
        payments: [
          payment(
            "44000000-0000-4000-8000-000000000002",
            paidBasketId,
            "10.00",
            "2026-09-03T10:02:00+00:00",
          ),
        ],
      },
      {
        id: basketId,
        restaurant_id: restaurantId,
        order_id: orderId,
        status: "PENDING",
        total_amount: "10.00",
        created_at: "2026-09-03T09:00:01+00:00",
        paid_at: null,
        payments: [
          payment(
            "44000000-0000-4000-8000-000000000001",
            basketId,
            "4.00",
            "2026-09-03T10:01:00+00:00",
          ),
        ],
      },
    ],
    ...overrides,
  };
}

describe("mapPendingPaymentOrderRow", () => {
  it("projects basket balances and immutable payment history in stable order", () => {
    const mapped = mapPendingPaymentOrderRow(row());

    expect(mapped).toMatchObject({
      id: orderId,
      status: "DELIVERED",
      totalAmount: "20.00",
      paidAmount: "14.00",
      outstandingBalance: "6.00",
      deliveredAt: "2026-09-03T10:00:00.000Z",
    });
    expect(mapped.baskets.map(({ id }) => id)).toEqual([
      basketId,
      paidBasketId,
    ]);
    expect(mapped.baskets[0]).toMatchObject({
      status: "PENDING",
      paidAmount: "4.00",
      outstandingBalance: "6.00",
      payments: [
        {
          amount: "4.00",
          paymentMethodCode: "cash",
          recordedBy: { id: waiterId, displayName: "Ana" },
          referenceNumber: "REF-1",
          comments: "Payment comment",
        },
      ],
    });
    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Object.isFrozen(mapped.baskets)).toBe(true);
    expect(Object.isFrozen(mapped.baskets[0].payments)).toBe(true);
  });

  it("calculates split-basket outstanding independently from authorized overage", () => {
    const source = row();
    const baskets = source.baskets as Array<Record<string, unknown>>;
    baskets[1] = {
      ...baskets[1],
      status: "PAID",
      paid_at: "2026-09-03T10:01:00+00:00",
      payments: [
        payment(
          "44000000-0000-4000-8000-000000000001",
          basketId,
          "12.00",
          "2026-09-03T10:01:00+00:00",
        ),
      ],
    };
    baskets[0] = {
      ...baskets[0],
      status: "PENDING",
      paid_at: null,
      payments: [],
    };

    const mapped = mapPendingPaymentOrderRow(source);
    expect(mapped.paidAmount).toBe("12.00");
    expect(mapped.outstandingBalance).toBe("10.00");
  });

  it.each([
    { restaurant_id: "30000000-0000-4000-8000-000000000002" },
    { status: "PAID", paid_at: "2026-09-03T10:03:00+00:00" },
    { paid_at: "2026-09-03T10:03:00+00:00" },
    { total_amount: "19.99" },
    { baskets: [] },
    { delivered_at: null },
  ])("fails closed for inconsistent order data %#", (override) => {
    expect(() => mapPendingPaymentOrderRow(row(override))).toThrow(
      PaymentQueryReadError,
    );
  });

  it("fails closed for cross-tenant, duplicate, and inconsistent payment data", () => {
    const crossTenant = row();
    const basket = (crossTenant.baskets as Array<Record<string, unknown>>)[0];
    const payments = basket.payments as Array<Record<string, unknown>>;
    payments[0] = { ...payments[0], restaurant_id: "private-tenant" };
    expect(() => mapPendingPaymentOrderRow(crossTenant)).toThrow(
      PaymentQueryReadError,
    );

    const badRecorder = row();
    const firstBasket = (
      badRecorder.baskets as Array<Record<string, unknown>>
    )[0];
    const firstPayments = firstBasket.payments as Array<
      Record<string, unknown>
    >;
    firstPayments[0] = {
      ...firstPayments[0],
      recorded_by: { id: waiterId, display_name: "" },
    };
    expect(() => mapPendingPaymentOrderRow(badRecorder)).toThrow(
      PaymentQueryReadError,
    );
  });
});

describe("SupabasePaymentQueryReader", () => {
  it("queries only unpaid states with exact filters and a minimal financial projection", async () => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    query.select = vi.fn(() => query);
    query.in = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.order = vi
      .fn()
      .mockReturnValueOnce(query)
      .mockResolvedValueOnce({ data: [row()], error: null });
    const from = vi.fn(() => query);
    const reader = new SupabasePaymentQueryReader({
      from,
    } as unknown as SupabaseClient);

    await expect(
      reader.listUnpaid({
        serviceLocationId: locationId,
        orderNumber: "ORD-42",
      }),
    ).resolves.toHaveLength(1);
    expect(query.in).toHaveBeenCalledWith("status", [
      "PENDING",
      "READY",
      "ON_THE_WAY",
      "DELIVERED",
    ]);
    expect(query.eq).toHaveBeenCalledWith("service_location_id", locationId);
    expect(query.eq).toHaveBeenCalledWith("order_number", "ORD-42");
    const projection = vi.mocked(query.select).mock.calls[0][0] as string;
    expect(projection).toContain("payment_method_name");
    expect(projection).toContain("display_name");
    expect(projection).not.toMatch(/email|role_permissions|overage_reason/i);
  });

  it("returns null for an absent detail and sanitizes provider failures", async () => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.in = vi.fn(() => query);
    query.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const reader = new SupabasePaymentQueryReader({
      from: vi.fn(() => query),
    } as unknown as SupabaseClient);

    await expect(reader.findUnpaidById(orderId)).resolves.toBeNull();
    query.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "database password: secret" },
    });
    await expect(reader.findUnpaidById(orderId)).rejects.toEqual(
      new PaymentQueryReadError(),
    );
  });
});
