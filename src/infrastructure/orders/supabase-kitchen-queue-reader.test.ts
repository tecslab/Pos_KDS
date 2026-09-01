import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  KitchenQueueReadError,
  mapKitchenQueueRow,
  SupabaseKitchenQueueReader,
} from "./supabase-kitchen-queue-reader";

const restaurantId = "30000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const currentLineId = "43000000-0000-4000-8000-000000000001";
const removedLineId = "43000000-0000-4000-8000-000000000002";
const firstSnapshotId = "44000000-0000-4000-8000-000000000001";
const currentSnapshotId = "44000000-0000-4000-8000-000000000002";

function snapshot(
  id: string,
  lineId: string,
  productName: string,
  observations: string | null,
) {
  return {
    id,
    restaurant_id: restaurantId,
    order_line_id: lineId,
    product_name: productName,
    quantity: 2,
    selected_options: [
      {
        id: "37000000-0000-4000-8000-000000000001",
        name: "Extra queso",
        priceAdjustment: "0.50",
      },
    ],
    removed_ingredients: [
      {
        id: "38000000-0000-4000-8000-000000000001",
        name: "Cebolla",
        priceAdjustment: null,
      },
    ],
    observations,
  };
}

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    restaurant_id: restaurantId,
    order_number: "ORD-42",
    status: "PENDING",
    created_at: "2026-08-31T10:00:00+00:00",
    service_location: {
      id: "31000000-0000-4000-8000-000000000001",
      restaurant_id: restaurantId,
      name: "Mesa 1",
      type: "TABLE",
    },
    baskets: [
      {
        id: basketId,
        restaurant_id: restaurantId,
        lines: [
          {
            id: removedLineId,
            restaurant_id: restaurantId,
            current_snapshot_id: "44000000-0000-4000-8000-000000000003",
            created_at: "2026-08-31T09:59:00+00:00",
            removal: {
              restaurant_id: restaurantId,
              order_line_id: removedLineId,
            },
            snapshots: [],
          },
          {
            id: currentLineId,
            restaurant_id: restaurantId,
            current_snapshot_id: currentSnapshotId,
            created_at: "2026-08-31T10:00:00+00:00",
            removal: null,
            snapshots: [
              snapshot(
                currentSnapshotId,
                currentLineId,
                "Taco actual",
                "Sin picante",
              ),
              snapshot(firstSnapshotId, currentLineId, "Taco histórico", null),
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function queueClient(result: { data: unknown; error: unknown | null }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValueOnce(query).mockResolvedValueOnce(result);
  const from = vi.fn().mockReturnValue(query);
  return { client: { from } as unknown as SupabaseClient, from, query };
}

describe("kitchen-queue persistence mapping", () => {
  it("uses only current active lines and strips all financial snapshot data", () => {
    const queueOrder = mapKitchenQueueRow(queueRow());

    expect(queueOrder).toEqual({
      id: orderId,
      restaurantId,
      orderNumber: "ORD-42",
      status: "PENDING",
      serviceLocation: {
        id: "31000000-0000-4000-8000-000000000001",
        name: "Mesa 1",
        type: "TABLE",
      },
      createdAt: "2026-08-31T10:00:00.000Z",
      lines: [
        {
          id: currentLineId,
          productName: "Taco actual",
          quantity: 2,
          selectedOptions: [
            {
              id: "37000000-0000-4000-8000-000000000001",
              name: "Extra queso",
            },
          ],
          removedIngredients: [
            {
              id: "38000000-0000-4000-8000-000000000001",
              name: "Cebolla",
            },
          ],
          observations: "Sin picante",
        },
      ],
    });
    const serialized = JSON.stringify(queueOrder);
    expect(serialized).not.toContain("priceAdjustment");
    expect(serialized).not.toContain("Taco histórico");
    expect(serialized).not.toContain(removedLineId);
  });

  it.each([
    queueRow({ status: "READY" }),
    queueRow({
      service_location: {
        ...(queueRow().service_location as object),
        restaurant_id: "30000000-0000-4000-8000-000000000099",
      },
    }),
    (() => {
      const row = queueRow();
      const basket = (row.baskets as Record<string, unknown>[])[0]!;
      const lines = basket.lines as Record<string, unknown>[];
      lines[1] = { ...lines[1], current_snapshot_id: firstSnapshotId };
      (lines[1]!.snapshots as Record<string, unknown>[]).splice(1, 1);
      return row;
    })(),
  ])(
    "fails closed for non-pending, cross-tenant, or stale persistence",
    (row) => {
      expect(() => mapKitchenQueueRow(row)).toThrow(KitchenQueueReadError);
    },
  );
});

describe("SupabaseKitchenQueueReader", () => {
  it("queries only pending orders in confirmation order with no financial columns", async () => {
    const fake = queueClient({ data: [queueRow()], error: null });

    await expect(
      new SupabaseKitchenQueueReader(fake.client).readPending(),
    ).resolves.toHaveLength(1);

    expect(fake.from).toHaveBeenCalledWith("orders");
    expect(fake.query.eq).toHaveBeenCalledWith("status", "PENDING");
    expect(fake.query.order).toHaveBeenNthCalledWith(1, "created_at", {
      ascending: true,
    });
    expect(fake.query.order).toHaveBeenNthCalledWith(2, "id", {
      ascending: true,
    });
    const selection = fake.query.select.mock.calls[0]?.[0] as string;
    expect(selection).toContain("current_snapshot_id");
    expect(selection).toContain("selected_options");
    for (const forbidden of [
      "total_amount",
      "payments",
      "base_unit_price",
      "final_unit_price",
      "line_total",
      "tax_rate",
      "assigned_waiter",
    ]) {
      expect(selection).not.toContain(forbidden);
    }
  });

  it.each([
    { data: null, error: null },
    { data: [], error: { message: "private provider detail" } },
  ])("sanitizes persistence failures", async (result) => {
    const fake = queueClient(result);

    await expect(
      new SupabaseKitchenQueueReader(fake.client).readPending(),
    ).rejects.toEqual(new KitchenQueueReadError());
  });
});
