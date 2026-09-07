import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { PaymentReceiptSnapshotRequest } from "../../application";
import {
  mapPaymentReceiptSnapshotRows,
  PaymentReceiptSnapshotReadError,
  SupabasePaymentReceiptSnapshotReader,
} from "./supabase-payment-receipt-snapshot-reader";

const request: PaymentReceiptSnapshotRequest = Object.freeze({
  restaurantId: "30000000-0000-4000-8000-000000000001",
  orderId: "41000000-0000-4000-8000-000000000001",
  basketId: "42000000-0000-4000-8000-000000000001",
  paymentMethodId: "43000000-0000-4000-8000-000000000001",
});
const lineId = "44000000-0000-4000-8000-000000000001";
const snapshotId = "45000000-0000-4000-8000-000000000001";

function basketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: request.basketId,
    restaurant_id: request.restaurantId,
    order_id: request.orderId,
    total_amount: "10.00",
    order: {
      id: request.orderId,
      restaurant_id: request.restaurantId,
      order_number: "ORD-42",
      restaurant: {
        id: request.restaurantId,
        name: "Carnales",
        configuration: {
          restaurant_id: request.restaurantId,
          receipt_header: "Restaurant header",
          receipt_footer: "Restaurant footer",
          printing_behavior: { paymentReceipts: { enabled: true } },
          thermal_printer_configuration: {
            paymentReceipts: { destinationId: "receipt-printer-1" },
          },
        },
      },
    },
    lines: [
      {
        id: lineId,
        restaurant_id: request.restaurantId,
        basket_id: request.basketId,
        current_snapshot_id: snapshotId,
        created_at: "2026-09-05T09:00:00Z",
        removal: null,
        snapshots: [
          {
            id: snapshotId,
            restaurant_id: request.restaurantId,
            order_line_id: lineId,
            product_name: "Historical Taco",
            quantity: 2,
            final_unit_price: "5.00",
            line_total: "10.00",
            selected_options: [{ id: "option-1", name: "Queso" }],
            removed_ingredients: [{ id: "ingredient-1", name: "Cebolla" }],
            observations: "Bien cocido",
          },
        ],
      },
    ],
    ...overrides,
  };
}

function methodRow(overrides: Record<string, unknown> = {}) {
  return {
    id: request.paymentMethodId,
    restaurant_id: request.restaurantId,
    receipt_configuration: {
      header: "Method header",
    },
    ...overrides,
  };
}

describe("mapPaymentReceiptSnapshotRows", () => {
  it("strictly maps and freezes current immutable sale snapshots and configured receipt values", () => {
    const mapped = mapPaymentReceiptSnapshotRows(
      basketRow(),
      methodRow(),
      request,
    );

    expect(mapped).toMatchObject({
      restaurantId: request.restaurantId,
      orderId: request.orderId,
      orderNumber: "ORD-42",
      basketId: request.basketId,
      basketTotalAmount: "10.00",
      receiptHeader: "Method header",
      receiptFooter: "Restaurant footer",
      printer: { enabled: true, destinationId: "receipt-printer-1" },
      lines: [
        {
          id: lineId,
          productName: "Historical Taco",
          quantity: 2,
          finalUnitPrice: "5.00",
          lineTotal: "10.00",
          selectedOptions: ["Queso"],
          removedIngredients: ["Cebolla"],
          observations: "Bien cocido",
        },
      ],
    });
    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Object.isFrozen(mapped.printer)).toBe(true);
    expect(Object.isFrozen(mapped.lines)).toBe(true);
    expect(Object.isFrozen(mapped.lines[0])).toBe(true);
  });

  it("treats missing or explicitly disabled receipt behavior as disabled", () => {
    const missingConfiguration = basketRow();
    const order = missingConfiguration.order as Record<string, unknown>;
    const restaurant = order.restaurant as Record<string, unknown>;
    restaurant.configuration = null;
    expect(
      mapPaymentReceiptSnapshotRows(
        missingConfiguration,
        methodRow({ receipt_configuration: null }),
        request,
      ).printer,
    ).toEqual({ enabled: false, destinationId: null });

    const disabled = basketRow();
    const disabledOrder = disabled.order as Record<string, unknown>;
    const disabledRestaurant = disabledOrder.restaurant as Record<
      string,
      unknown
    >;
    disabledRestaurant.configuration = {
      restaurant_id: request.restaurantId,
      receipt_header: null,
      receipt_footer: null,
      printing_behavior: { paymentReceipts: { enabled: false } },
      thermal_printer_configuration: null,
    };
    expect(
      mapPaymentReceiptSnapshotRows(disabled, methodRow(), request).printer,
    ).toEqual({ enabled: false, destinationId: null });
  });

  it("preserves valid zero-priced lines in a positive basket", () => {
    const source = basketRow();
    const lines = source.lines as Array<Record<string, unknown>>;
    const paidLine = lines[0] as Record<string, unknown>;
    const paidSnapshot = (
      paidLine.snapshots as Array<Record<string, unknown>>
    )[0];
    paidSnapshot.quantity = 1;
    paidSnapshot.final_unit_price = "10.00";
    paidSnapshot.line_total = "10.00";
    lines.push({
      ...paidLine,
      id: "44000000-0000-4000-8000-000000000002",
      current_snapshot_id: "45000000-0000-4000-8000-000000000002",
      created_at: "2026-09-05T09:01:00Z",
      snapshots: [
        {
          ...paidSnapshot,
          id: "45000000-0000-4000-8000-000000000002",
          order_line_id: "44000000-0000-4000-8000-000000000002",
          product_name: "Complimentary Salsa",
          final_unit_price: "0.00",
          line_total: "0.00",
        },
      ],
    });

    expect(
      mapPaymentReceiptSnapshotRows(source, methodRow(), request).lines,
    ).toEqual([
      expect.objectContaining({ productName: "Historical Taco" }),
      expect.objectContaining({
        productName: "Complimentary Salsa",
        finalUnitPrice: "0.00",
        lineTotal: "0.00",
      }),
    ]);
  });

  it.each([
    ["cross-tenant basket", { restaurant_id: "private-tenant" }],
    ["wrong order", { order_id: "41000000-0000-4000-8000-000000000002" }],
    ["wrong total", { total_amount: "9.99" }],
    ["no sale lines", { lines: [] }],
  ])("fails closed for %s", (_label, overrides) => {
    expect(() =>
      mapPaymentReceiptSnapshotRows(basketRow(overrides), methodRow(), request),
    ).toThrow(PaymentReceiptSnapshotReadError);
  });

  it("fails closed when current snapshot linkage is inconsistent", () => {
    const source = basketRow();
    const lines = source.lines as Array<Record<string, unknown>>;
    lines[0] = {
      ...lines[0],
      current_snapshot_id: "45000000-0000-4000-8000-000000000002",
    };
    expect(() =>
      mapPaymentReceiptSnapshotRows(source, methodRow(), request),
    ).toThrow(PaymentReceiptSnapshotReadError);
  });

  it("fails closed when nested restaurant configuration crosses tenants", () => {
    const source = basketRow();
    const order = source.order as Record<string, unknown>;
    const restaurant = order.restaurant as Record<string, unknown>;
    const configuration = restaurant.configuration as Record<string, unknown>;
    configuration.restaurant_id = "30000000-0000-4000-8000-000000000002";

    expect(() =>
      mapPaymentReceiptSnapshotRows(source, methodRow(), request),
    ).toThrow(PaymentReceiptSnapshotReadError);
  });
});

describe("SupabasePaymentReceiptSnapshotReader", () => {
  it("reads only the linked basket and method through read-only projections", async () => {
    const queries = [queryReturning(basketRow()), queryReturning(methodRow())];
    const from = vi
      .fn()
      .mockImplementationOnce(() => queries[0])
      .mockImplementationOnce(() => queries[1]);
    const reader = new SupabasePaymentReceiptSnapshotReader({
      from,
    } as unknown as SupabaseClient);

    await expect(reader.read(request)).resolves.toMatchObject({
      basketId: request.basketId,
      orderId: request.orderId,
    });
    expect(from).toHaveBeenNthCalledWith(1, "customer_baskets");
    expect(from).toHaveBeenNthCalledWith(2, "payment_methods");
    expect(queries[0].eq).toHaveBeenCalledWith("id", request.basketId);
    expect(queries[0].eq).toHaveBeenCalledWith(
      "restaurant_id",
      request.restaurantId,
    );
    expect(queries[1].eq).toHaveBeenCalledWith("id", request.paymentMethodId);
    expect(queries[1].eq).toHaveBeenCalledWith(
      "restaurant_id",
      request.restaurantId,
    );
    const basketProjection = queries[0].select.mock.calls[0]?.[0] as string;
    expect(basketProjection).toContain("current_snapshot_id");
    expect(basketProjection).toContain("order_line_sale_snapshots");
    expect(basketProjection).not.toMatch(/payments\s*\(/i);
  });

  it("returns null for missing linked data and sanitizes provider errors", async () => {
    const missingReader = new SupabasePaymentReceiptSnapshotReader({
      from: vi
        .fn()
        .mockReturnValueOnce(queryReturning(null))
        .mockReturnValueOnce(queryReturning(methodRow())),
    } as unknown as SupabaseClient);
    await expect(missingReader.read(request)).resolves.toBeNull();

    const failedReader = new SupabasePaymentReceiptSnapshotReader({
      from: vi
        .fn()
        .mockReturnValueOnce(
          queryReturning(null, { message: "database password secret" }),
        )
        .mockReturnValueOnce(queryReturning(methodRow())),
    } as unknown as SupabaseClient);
    await expect(failedReader.read(request)).rejects.toEqual(
      new PaymentReceiptSnapshotReadError(),
    );
  });
});

function queryReturning(data: unknown, error: unknown = null) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  return query;
}
