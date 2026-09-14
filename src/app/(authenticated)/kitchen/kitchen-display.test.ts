import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  RealtimeEventName,
  RealtimeMessage,
  RealtimeSubscriber,
  RealtimeSubscription,
  RealtimeSubscriptionRequest,
} from "@/application";

import {
  elapsedMilliseconds,
  formatElapsedTime,
  kitchenPriority,
  KitchenQueueRealtimeController,
  parseKitchenQueuePayload,
  parseKitchenReadyResult,
  type KitchenConnectionStatus,
} from "./kitchen-display";

const restaurantId = "30000000-0000-4000-8000-000000000001";

function queueOrder(
  id = "41000000-0000-4000-8000-000000000001",
  createdAt = "2026-08-31T10:00:00.000Z",
) {
  return {
    id,
    restaurantId,
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
        removedIngredients: [
          {
            id: "38000000-0000-4000-8000-000000000001",
            name: "Cebolla",
          },
        ],
        observations: "Sin picante",
      },
    ],
  };
}

function message(eventName: RealtimeEventName): RealtimeMessage {
  return {
    eventName,
    envelope: {
      version: 1,
      occurredAt: "2026-08-31T10:00:00.000Z",
      restaurantId,
      entityId: "41000000-0000-4000-8000-000000000001",
      entityType: "order",
      data: {},
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("kitchen display presentation", () => {
  it("uses configured warning and critical boundaries inclusively", () => {
    const createdAt = "2026-08-31T10:00:00.000Z";
    const thresholds = { warningMinutes: 5, criticalMinutes: 8 };

    expect(
      kitchenPriority(
        createdAt,
        Date.parse("2026-08-31T10:04:59.999Z"),
        thresholds,
      ),
    ).toBe("normal");
    expect(
      kitchenPriority(
        createdAt,
        Date.parse("2026-08-31T10:05:00.000Z"),
        thresholds,
      ),
    ).toBe("warning");
    expect(
      kitchenPriority(
        createdAt,
        Date.parse("2026-08-31T10:08:00.000Z"),
        thresholds,
      ),
    ).toBe("critical");
  });

  it("formats a running elapsed timer and clamps future timestamps", () => {
    expect(formatElapsedTime(3_723_000)).toBe("1 h 02 min 03 s");
    expect(
      elapsedMilliseconds(
        "2026-08-31T10:01:00.000Z",
        Date.parse("2026-08-31T10:00:00.000Z"),
      ),
    ).toBe(0);
  });

  it("validates and restores deterministic confirmation order without financial data", () => {
    const later = queueOrder(
      "41000000-0000-4000-8000-000000000002",
      "2026-08-31T10:01:00.000Z",
    );
    const earlier = queueOrder();
    const parsed = parseKitchenQueuePayload({ orders: [later, earlier] });

    expect(parsed?.map(({ id }) => id)).toEqual([earlier.id, later.id]);
    expect(JSON.stringify(parsed)).not.toMatch(/price|total|payment/i);
    expect(
      parseKitchenQueuePayload({
        orders: [{ ...earlier, status: "READY" }],
      }),
    ).toBeNull();
  });

  it("accepts only the expected canonical Ready response", () => {
    const orderId = "41000000-0000-4000-8000-000000000001";
    expect(
      parseKitchenReadyResult(
        {
          orderId,
          status: "READY",
          readyAt: "2026-09-01T10:00:00.000Z",
        },
        orderId,
      ),
    ).toEqual({
      orderId,
      status: "READY",
      readyAt: "2026-09-01T10:00:00.000Z",
    });
    expect(
      parseKitchenReadyResult(
        { orderId, status: "PENDING", readyAt: "not-a-time" },
        orderId,
      ),
    ).toBeNull();
  });
});

describe("KitchenQueueRealtimeController", () => {
  it("propagates an authorized queue refresh to the display before the one-second target", async () => {
    vi.useFakeTimers();
    let request: RealtimeSubscriptionRequest | undefined;
    const subscriber: RealtimeSubscriber = {
      subscribe: vi.fn(async (candidate) => {
        request = candidate;
        return { unsubscribe: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    let displayedOrderCount = 0;
    const refreshQueue = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              displayedOrderCount = 1;
              resolve();
            }, 999);
          }),
      );
    const controller = new KitchenQueueRealtimeController({
      subscriber,
      restaurantIds: [restaurantId],
      refreshQueue,
      onStatus: vi.fn(),
    });

    await controller.start();
    request!.onMessage(message("order.created"));
    await vi.advanceTimersByTimeAsync(999);

    expect(refreshQueue).toHaveBeenCalledTimes(2);
    expect(displayedOrderCount).toBe(1);
    await controller.stop();
  });

  it("refetches queue and kitchen-status events and cleans up", async () => {
    const requests: RealtimeSubscriptionRequest[] = [];
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const subscriber: RealtimeSubscriber = {
      subscribe: vi.fn(async (request) => {
        requests.push(request);
        return { unsubscribe };
      }),
    };
    const refreshQueue = vi.fn().mockResolvedValue(undefined);
    const statuses: KitchenConnectionStatus[] = [];
    const controller = new KitchenQueueRealtimeController({
      subscriber,
      restaurantIds: [restaurantId],
      refreshQueue,
      onStatus: (status) => statuses.push(status),
    });

    await controller.start();
    const queueEvents = [
      "order.created",
      "order.modified",
      "order.cancelled",
      "kitchen.status.updated",
    ] as const;
    for (const [index, eventName] of queueEvents.entries()) {
      requests[0]!.onMessage(message(eventName));
      await vi.waitFor(() =>
        expect(refreshQueue).toHaveBeenCalledTimes(index + 2),
      );
    }
    requests[0]!.onMessage(message("inventory.alert"));

    expect(statuses).toEqual(["connecting", "live"]);
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId, topic: "kitchen" }),
    );
    expect(refreshQueue).toHaveBeenCalledTimes(5);

    await controller.stop();
    await controller.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("reconciles the SSR snapshot after the live subscription is established", async () => {
    let establishSubscription:
      ((subscription: { unsubscribe(): Promise<void> }) => void) | undefined;
    const subscriber: RealtimeSubscriber = {
      subscribe: vi.fn(
        () =>
          new Promise<RealtimeSubscription>((resolve) => {
            establishSubscription = resolve;
          }),
      ),
    };
    const refreshQueue = vi.fn().mockResolvedValue(undefined);
    const controller = new KitchenQueueRealtimeController({
      subscriber,
      restaurantIds: [restaurantId],
      refreshQueue,
      onStatus: vi.fn(),
    });

    const started = controller.start();
    await Promise.resolve();
    expect(refreshQueue).not.toHaveBeenCalled();

    establishSubscription!({
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    });
    await started;

    expect(refreshQueue).toHaveBeenCalledOnce();
    await controller.stop();
  });

  it("falls back after a refresh error and returns live after recovery", async () => {
    vi.useFakeTimers();
    let request: RealtimeSubscriptionRequest | undefined;
    const subscriber: RealtimeSubscriber = {
      subscribe: vi.fn(async (candidate) => {
        request = candidate;
        return { unsubscribe: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    const refreshQueue = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("temporary API failure"))
      .mockResolvedValue(undefined);
    const statuses: KitchenConnectionStatus[] = [];
    const controller = new KitchenQueueRealtimeController({
      subscriber,
      restaurantIds: [restaurantId],
      refreshQueue,
      onStatus: (status) => statuses.push(status),
    });

    await controller.start();
    request!.onMessage(message("order.modified"));
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("degraded");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(refreshQueue).toHaveBeenCalledTimes(3);
    expect(statuses.at(-1)).toBe("live");

    await controller.stop();
  });

  it("keeps periodic recovery active after terminal subscription failure", async () => {
    vi.useFakeTimers();
    let request: RealtimeSubscriptionRequest | undefined;
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const subscriber: RealtimeSubscriber = {
      subscribe: vi.fn(async (candidate) => {
        request = candidate;
        return { unsubscribe };
      }),
    };
    const refreshQueue = vi.fn().mockResolvedValue(undefined);
    const statuses: KitchenConnectionStatus[] = [];
    const controller = new KitchenQueueRealtimeController({
      subscriber,
      restaurantIds: [restaurantId],
      refreshQueue,
      onStatus: (status) => statuses.push(status),
    });

    await controller.start();
    request!.onTerminalFailure?.({
      code: "REALTIME_SUBSCRIPTION_TERMINATED",
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(refreshQueue).toHaveBeenCalledTimes(3);
    expect(statuses.at(-1)).toBe("degraded");

    await controller.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refreshQueue).toHaveBeenCalledTimes(3);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
