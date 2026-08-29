import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { ACTIVE_ORDER_STATUSES } from "../../application";
import {
  ActiveOrderReadError,
  mapActiveOrderDetailRow,
  SupabaseActiveOrderReader,
} from "./supabase-active-order-reader";

const restaurantId = "30000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const lineId = "43000000-0000-4000-8000-000000000001";
const snapshot1 = "44000000-0000-4000-8000-000000000001";
const snapshot2 = "44000000-0000-4000-8000-000000000002";

function snapshot(id: string, revision: number, name: string, amount: string) {
  return {
    id,
    restaurant_id: restaurantId,
    order_line_id: lineId,
    revision_number: revision,
    product_version_id: "36000000-0000-4000-8000-000000000002",
    product_name: name,
    quantity: 2,
    base_unit_price: amount,
    final_unit_price: amount,
    line_total: (Number(amount) * 2).toFixed(2),
    tax_code: "IVA",
    tax_name: "IVA 15%",
    tax_rate: "0.150000",
    price_includes_tax: true,
    selected_options: [
      {
        id: "37000000-0000-4000-8000-000000000001",
        name: "Extra queso histórico",
        priceAdjustment: "0.50",
      },
    ],
    removed_ingredients: [],
    observations: revision === 1 ? null : "Sin picante",
    created_at: `2026-08-25T10:0${revision}:00+00:00`,
  };
}

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    restaurant_id: restaurantId,
    order_number: "ORD-42",
    status: "READY",
    notes: "Mesa cumpleaños",
    total_amount: "12.00",
    created_at: "2026-08-25T10:00:00+00:00",
    updated_at: "2026-08-25T10:10:00+00:00",
    ready_at: "2026-08-25T10:10:00+00:00",
    on_the_way_at: null,
    delivered_at: null,
    paid_at: null,
    service_location: {
      id: "31000000-0000-4000-8000-000000000001",
      restaurant_id: restaurantId,
      name: "Mesa 1",
      type: "TABLE",
    },
    assigned_waiter: {
      id: "10000000-0000-4000-8000-000000000001",
      display_name: "Ana",
    },
    baskets: [
      {
        id: basketId,
        restaurant_id: restaurantId,
        status: "PENDING",
        total_amount: "12.00",
        created_at: "2026-08-25T10:00:00+00:00",
        paid_at: null,
        payments: [
          { restaurant_id: restaurantId, amount: "4.25" },
          { restaurant_id: restaurantId, amount: "1.75" },
        ],
        lines: [
          {
            id: lineId,
            restaurant_id: restaurantId,
            current_snapshot_id: snapshot2,
            created_at: "2026-08-25T10:00:00+00:00",
            snapshots: [
              snapshot(snapshot2, 2, "Snapshot actual", "6.00"),
              snapshot(snapshot1, 1, "Snapshot original", "5.00"),
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function detailClient(result: { data: unknown; error: unknown | null }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  return { client: { from } as unknown as SupabaseClient, from, query };
}

describe("active-order persistence mapping", () => {
  it("derives balances without exposing payments and returns all immutable revisions", () => {
    const detail = mapActiveOrderDetailRow(detailRow());

    expect(detail).toMatchObject({
      id: orderId,
      status: "READY",
      totalAmount: "12.00",
      paidAmount: "6.00",
      outstandingBalance: "6.00",
      readyAt: "2026-08-25T10:10:00.000Z",
      baskets: [
        {
          id: basketId,
          paidAmount: "6.00",
          outstandingBalance: "6.00",
          lineCount: 1,
          lines: [
            {
              id: lineId,
              currentSnapshotId: snapshot2,
              currentSnapshot: {
                id: snapshot2,
                productName: "Snapshot actual",
              },
              snapshots: [
                { id: snapshot1, revisionNumber: 1 },
                { id: snapshot2, revisionNumber: 2 },
              ],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(detail)).not.toContain("payments");
    expect(Object.isFrozen(detail.baskets[0]?.lines[0]?.snapshots)).toBe(true);
  });

  it("excludes immutably removed lines from active line counts and totals", () => {
    const row = detailRow();
    const basket = (row.baskets as Record<string, unknown>[])[0]!;
    basket.lines = [
      ...(basket.lines as Record<string, unknown>[]),
      {
        id: "43000000-0000-4000-8000-000000000099",
        restaurant_id: restaurantId,
        removal: {
          restaurant_id: restaurantId,
          order_line_id: "43000000-0000-4000-8000-000000000099",
        },
      },
    ];

    const detail = mapActiveOrderDetailRow(row);

    expect(detail.baskets[0]?.lineCount).toBe(1);
    expect(detail.baskets[0]?.lines.map(({ id }) => id)).toEqual([lineId]);
  });

  it.each([
    detailRow({ status: "PAID" }),
    detailRow({
      service_location: {
        ...(detailRow().service_location as object),
        restaurant_id: "30000000-0000-4000-8000-000000000099",
      },
    }),
    detailRow({
      baskets: [
        {
          ...(detailRow().baskets as Record<string, unknown>[])[0],
          payments: [
            {
              restaurant_id: "30000000-0000-4000-8000-000000000099",
              amount: "1.00",
            },
          ],
        },
      ],
    }),
  ])("fails closed for inactive or cross-restaurant persistence", (row) => {
    expect(() => mapActiveOrderDetailRow(row)).toThrow(ActiveOrderReadError);
  });
});

describe("SupabaseActiveOrderReader", () => {
  it("filters the list query to active states with deterministic ordering", async () => {
    const query = {
      select: vi.fn(),
      in: vi.fn(),
      order: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.order
      .mockReturnValueOnce(query)
      .mockResolvedValueOnce({ data: [], error: null });
    const from = vi.fn().mockReturnValue(query);

    await expect(
      new SupabaseActiveOrderReader({
        from,
      } as unknown as SupabaseClient).listByStatuses(ACTIVE_ORDER_STATUSES),
    ).resolves.toEqual([]);

    expect(from).toHaveBeenCalledWith("orders");
    expect(query.in).toHaveBeenCalledWith("status", [...ACTIVE_ORDER_STATUSES]);
    expect(query.order).toHaveBeenNthCalledWith(1, "created_at", {
      ascending: true,
    });
    expect(query.order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
    expect(query.select.mock.calls[0]?.[0]).toContain(
      "payments (restaurant_id, amount)",
    );
    expect(query.select.mock.calls[0]?.[0]).not.toContain(
      "payment_method_name",
    );
  });

  it("filters detail by order and active states, selects persisted snapshots, and maps maybeSingle", async () => {
    const fake = detailClient({ data: detailRow(), error: null });
    const reader = new SupabaseActiveOrderReader(fake.client);

    await expect(
      reader.findByIdAndStatuses(orderId, ACTIVE_ORDER_STATUSES),
    ).resolves.toMatchObject({
      id: orderId,
      status: "READY",
      baskets: [
        {
          lines: [
            {
              currentSnapshot: { id: snapshot2 },
              snapshots: [
                { id: snapshot1, revisionNumber: 1 },
                { id: snapshot2, revisionNumber: 2 },
              ],
            },
          ],
        },
      ],
    });

    expect(fake.from).toHaveBeenCalledWith("orders");
    expect(fake.query.eq).toHaveBeenCalledWith("id", orderId);
    expect(fake.query.in).toHaveBeenCalledWith("status", [
      ...ACTIVE_ORDER_STATUSES,
    ]);
    expect(fake.query.maybeSingle).toHaveBeenCalledOnce();
    const selection = fake.query.select.mock.calls[0]?.[0] as string;
    expect(selection).toContain("current_snapshot_id");
    expect(selection).toContain("order_line_sale_snapshots");
    expect(selection).toContain("revision_number");
    expect(selection).toContain("selected_options");
    expect(selection).not.toContain("payment_method_name");
  });

  it("returns null when maybeSingle finds no active order", async () => {
    const fake = detailClient({ data: null, error: null });

    await expect(
      new SupabaseActiveOrderReader(fake.client).findByIdAndStatuses(
        orderId,
        ACTIVE_ORDER_STATUSES,
      ),
    ).resolves.toBeNull();
    expect(fake.query.maybeSingle).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: "malformed relation graph",
      result: {
        data: detailRow({ service_location: null }),
        error: null,
      },
    },
    {
      label: "provider failure",
      result: {
        data: null,
        error: { message: "private provider detail" },
      },
    },
  ])("sanitizes $label", async ({ result }) => {
    const fake = detailClient(result);

    await expect(
      new SupabaseActiveOrderReader(fake.client).findByIdAndStatuses(
        orderId,
        ACTIVE_ORDER_STATUSES,
      ),
    ).rejects.toEqual(new ActiveOrderReadError());
  });
});
