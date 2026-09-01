import { describe, expect, it, vi } from "vitest";

import type { KitchenQueueOrder, KitchenQueueReader } from "./kitchen-queue";
import { KitchenQueueService } from "./kitchen-queue";

function order(
  id: string,
  createdAt: string,
  overrides: Partial<KitchenQueueOrder> = {},
): KitchenQueueOrder {
  return {
    id,
    restaurantId: "30000000-0000-4000-8000-000000000001",
    orderNumber: `ORD-${id.slice(-1)}`,
    status: "PENDING",
    serviceLocation: {
      id: "31000000-0000-4000-8000-000000000001",
      name: "Mesa 1",
      type: "TABLE",
    },
    createdAt,
    lines: [
      {
        id: "43000000-0000-4000-8000-000000000001",
        productName: "Taco mixto",
        quantity: 2,
        selectedOptions: [
          {
            id: "37000000-0000-4000-8000-000000000001",
            name: "Extra queso",
          },
        ],
        removedIngredients: [],
        observations: "Sin picante",
      },
    ],
    ...overrides,
  };
}

function reader(result: readonly KitchenQueueOrder[] = []): KitchenQueueReader {
  return { readPending: vi.fn().mockResolvedValue(result) };
}

describe("KitchenQueueService", () => {
  it("returns only pending orders in deterministic confirmation order", async () => {
    const laterId = "41000000-0000-4000-8000-000000000002";
    const earlierId = "41000000-0000-4000-8000-000000000001";
    const source = reader([
      order(laterId, "2026-08-31T10:01:00.000Z"),
      order(earlierId, "2026-08-31T10:00:00.000Z"),
    ]);

    const result = await new KitchenQueueService(source).read();

    expect(source.readPending).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      value: [{ id: earlierId }, { id: laterId }],
    });
    expect(result.ok && Object.isFrozen(result.value)).toBe(true);
  });

  it("projects the exact non-financial preparation contract", async () => {
    const richOrder = {
      ...order(
        "41000000-0000-4000-8000-000000000001",
        "2026-08-31T10:00:00.000Z",
      ),
      totalAmount: "99.99",
      paidAmount: "1.00",
      assignedWaiter: { displayName: "Private" },
      lines: [
        {
          ...order(
            "41000000-0000-4000-8000-000000000001",
            "2026-08-31T10:00:00.000Z",
          ).lines[0]!,
          finalUnitPrice: "99.99",
          selectedOptions: [
            {
              id: "37000000-0000-4000-8000-000000000001",
              name: "Extra queso",
              priceAdjustment: "9.99",
            },
          ],
        },
      ],
    } as unknown as KitchenQueueOrder;

    const result = await new KitchenQueueService(reader([richOrder])).read();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]).toEqual(
      order("41000000-0000-4000-8000-000000000001", "2026-08-31T10:00:00.000Z"),
    );
    const serialized = JSON.stringify(result.value);
    for (const forbidden of [
      "totalAmount",
      "paidAmount",
      "assignedWaiter",
      "finalUnitPrice",
      "priceAdjustment",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.isFrozen(result.value[0]?.lines[0]?.selectedOptions)).toBe(
      true,
    );
  });

  it("fails closed for persistence failures and malformed queue entries", async () => {
    const failedReader: KitchenQueueReader = {
      readPending: vi.fn().mockRejectedValue(new Error("private detail")),
    };
    await expect(new KitchenQueueService(failedReader).read()).resolves.toEqual(
      {
        ok: false,
        error: {
          kind: "kitchen-queue-error",
          code: "OPERATION_FAILED",
        },
      },
    );

    const malformed = order(
      "41000000-0000-4000-8000-000000000001",
      "not-a-date",
      { status: "READY" as "PENDING" },
    );
    await expect(
      new KitchenQueueService(reader([malformed])).read(),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
  });
});
