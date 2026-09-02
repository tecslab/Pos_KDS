import { describe, expect, it, vi } from "vitest";

import type { DeliveryQueueOrder, DeliveryQueueReader } from "./delivery-queue";
import {
  DeliveryQueueService,
  parseDeliveryQueueFilters,
} from "./delivery-queue";

const now = new Date("2026-09-01T12:00:00.000Z");

function order(
  id: string,
  readyAt: string,
  overrides: Partial<DeliveryQueueOrder> = {},
): DeliveryQueueOrder {
  return {
    id,
    restaurantId: "30000000-0000-4000-8000-000000000001",
    orderNumber: `ORD-${id.slice(-1)}`,
    status: "READY",
    serviceLocation: {
      id: "31000000-0000-4000-8000-000000000001",
      name: "Mesa 1",
      type: "TABLE",
    },
    notes: "Sin cubiertos",
    createdAt: "2026-09-01T11:30:00.000Z",
    readyAt,
    lines: [
      {
        id: "43000000-0000-4000-8000-000000000001",
        quantity: 2,
        observations: "Sin picante",
      },
      {
        id: "43000000-0000-4000-8000-000000000002",
        quantity: 3,
        observations: null,
      },
    ],
    ...overrides,
  };
}

function reader(
  result: readonly DeliveryQueueOrder[] = [],
): DeliveryQueueReader {
  return { readReady: vi.fn().mockResolvedValue(result) };
}

describe("parseDeliveryQueueFilters", () => {
  it("normalizes exact location and order filters and creates an inclusive wait cutoff", () => {
    expect(
      parseDeliveryQueueFilters(
        {
          serviceLocationId: "31000000-0000-4000-8000-000000000001",
          orderNumber: "  ORD-42  ",
          minimumWaitingMinutes: "5",
        },
        now,
      ),
    ).toEqual({
      serviceLocationId: "31000000-0000-4000-8000-000000000001",
      orderNumber: "ORD-42",
      minimumWaitingMinutes: 5,
      readyAtBeforeOrEqual: "2026-09-01T11:55:00.000Z",
    });
  });

  it.each([
    { serviceLocationId: "not-a-uuid" },
    { orderNumber: "   " },
    { minimumWaitingMinutes: "01" },
    { minimumWaitingMinutes: "1.5" },
    { minimumWaitingMinutes: "1441" },
  ])("rejects invalid filter values: %o", (input) => {
    expect(parseDeliveryQueueFilters(input, now)).toBeNull();
  });
});

describe("DeliveryQueueService", () => {
  it("projects ready-only operational data with waiting time, quantity sum, and observations", async () => {
    const source = reader([
      order("41000000-0000-4000-8000-000000000002", "2026-09-01T11:55:00Z"),
      order("41000000-0000-4000-8000-000000000001", "2026-09-01T11:50:00Z"),
    ]);

    const result = await new DeliveryQueueService(source, () => now).read({});

    expect(source.readReady).toHaveBeenCalledWith({
      serviceLocationId: null,
      orderNumber: null,
      minimumWaitingMinutes: null,
      readyAtBeforeOrEqual: null,
    });
    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: "41000000-0000-4000-8000-000000000001",
          restaurantId: "30000000-0000-4000-8000-000000000001",
          orderNumber: "ORD-1",
          status: "READY",
          serviceLocation: {
            id: "31000000-0000-4000-8000-000000000001",
            name: "Mesa 1",
            type: "TABLE",
          },
          createdAt: "2026-09-01T11:30:00.000Z",
          readyAt: "2026-09-01T11:50:00.000Z",
          waitingTimeSeconds: 600,
          productCount: 5,
          specialObservations: ["Sin cubiertos", "Sin picante"],
        },
        expect.objectContaining({
          id: "41000000-0000-4000-8000-000000000002",
          waitingTimeSeconds: 300,
        }),
      ],
    });
  });

  it("keeps the minimum wait boundary inclusive through the persistence filter", async () => {
    const source = reader([
      order("41000000-0000-4000-8000-000000000001", "2026-09-01T11:55:00Z"),
    ]);

    const result = await new DeliveryQueueService(source, () => now).read({
      minimumWaitingMinutes: "5",
    });

    expect(source.readReady).toHaveBeenCalledWith(
      expect.objectContaining({
        minimumWaitingMinutes: 5,
        readyAtBeforeOrEqual: "2026-09-01T11:55:00.000Z",
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: [{ waitingTimeSeconds: 300 }],
    });
  });

  it("fails closed for non-ready, future, malformed, and persistence data", async () => {
    const failedReader: DeliveryQueueReader = {
      readReady: vi.fn().mockRejectedValue(new Error("private detail")),
    };
    await expect(
      new DeliveryQueueService(failedReader, () => now).read({}),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });

    for (const malformed of [
      order("41000000-0000-4000-8000-000000000001", "2026-09-01T11:55:00Z", {
        status: "PENDING" as "READY",
      }),
      order("41000000-0000-4000-8000-000000000001", "2026-09-01T12:01:00Z"),
    ]) {
      await expect(
        new DeliveryQueueService(reader([malformed]), () => now).read({}),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "OPERATION_FAILED" },
      });
    }
  });
});
