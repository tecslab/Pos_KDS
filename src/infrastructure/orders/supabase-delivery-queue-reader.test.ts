import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  DeliveryQueueReadError,
  mapDeliveryQueueRow,
  SupabaseDeliveryQueueReader,
} from "./supabase-delivery-queue-reader";

const restaurantId = "30000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const currentLineId = "43000000-0000-4000-8000-000000000001";
const removedLineId = "43000000-0000-4000-8000-000000000002";
const currentSnapshotId = "44000000-0000-4000-8000-000000000001";

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    restaurant_id: restaurantId,
    order_number: "ORD-42",
    status: "READY",
    notes: "Sin cubiertos",
    created_at: "2026-09-01T10:00:00+00:00",
    ready_at: "2026-09-01T11:55:00+00:00",
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
            current_snapshot_id: "44000000-0000-4000-8000-000000000002",
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
            removal: null,
            snapshots: [
              {
                id: currentSnapshotId,
                restaurant_id: restaurantId,
                order_line_id: currentLineId,
                quantity: 2,
                observations: "Sin picante",
                final_unit_price: "99.99",
              },
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
    lte: vi.fn(),
    order: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.lte.mockReturnValue(query);
  query.order.mockReturnValueOnce(query).mockResolvedValueOnce(result);
  const from = vi.fn().mockReturnValue(query);
  return { client: { from } as unknown as SupabaseClient, from, query };
}

describe("delivery-queue persistence mapping", () => {
  it("maps Ready data with only active current quantities and operational observations", () => {
    const queueOrder = mapDeliveryQueueRow(queueRow());

    expect(queueOrder).toEqual({
      id: orderId,
      restaurantId,
      orderNumber: "ORD-42",
      status: "READY",
      serviceLocation: {
        id: "31000000-0000-4000-8000-000000000001",
        name: "Mesa 1",
        type: "TABLE",
      },
      notes: "Sin cubiertos",
      createdAt: "2026-09-01T10:00:00.000Z",
      readyAt: "2026-09-01T11:55:00.000Z",
      lines: [
        {
          id: currentLineId,
          quantity: 2,
          observations: "Sin picante",
        },
      ],
    });
    const serialized = JSON.stringify(queueOrder);
    expect(serialized).not.toContain("final_unit_price");
    expect(serialized).not.toContain(removedLineId);
  });

  it.each([
    queueRow({ status: "PENDING" }),
    queueRow({ ready_at: null }),
    queueRow({
      service_location: {
        ...(queueRow().service_location as object),
        restaurant_id: "30000000-0000-4000-8000-000000000099",
      },
    }),
  ])("fails closed for non-ready or malformed persistence", (row) => {
    expect(() => mapDeliveryQueueRow(row)).toThrow(DeliveryQueueReadError);
  });
});

describe("SupabaseDeliveryQueueReader", () => {
  it("uses exact location/order filters, inclusive waiting cutoff, and oldest-ready ordering", async () => {
    const fake = queueClient({ data: [queueRow()], error: null });

    await expect(
      new SupabaseDeliveryQueueReader(fake.client).readReady({
        serviceLocationId: "31000000-0000-4000-8000-000000000001",
        orderNumber: "ORD-42",
        minimumWaitingMinutes: 5,
        readyAtBeforeOrEqual: "2026-09-01T11:55:00.000Z",
      }),
    ).resolves.toHaveLength(1);

    expect(fake.from).toHaveBeenCalledWith("orders");
    expect(fake.query.eq).toHaveBeenNthCalledWith(1, "status", "READY");
    expect(fake.query.eq).toHaveBeenNthCalledWith(
      2,
      "service_location_id",
      "31000000-0000-4000-8000-000000000001",
    );
    expect(fake.query.eq).toHaveBeenNthCalledWith(3, "order_number", "ORD-42");
    expect(fake.query.lte).toHaveBeenCalledWith(
      "ready_at",
      "2026-09-01T11:55:00.000Z",
    );
    expect(fake.query.order).toHaveBeenNthCalledWith(1, "ready_at", {
      ascending: true,
    });
    expect(fake.query.order).toHaveBeenNthCalledWith(2, "id", {
      ascending: true,
    });
    const selection = fake.query.select.mock.calls[0]?.[0] as string;
    for (const required of ["notes", "ready_at", "quantity", "observations"]) {
      expect(selection).toContain(required);
    }
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
      new SupabaseDeliveryQueueReader(fake.client).readReady({
        serviceLocationId: null,
        orderNumber: null,
        minimumWaitingMinutes: null,
        readyAtBeforeOrEqual: null,
      }),
    ).rejects.toEqual(new DeliveryQueueReadError());
  });
});
