import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  RealtimeEventName,
  RealtimeMessage,
  RealtimeSubscriber,
  RealtimeSubscriptionRequest,
} from "@/application";

import {
  DeliveryQueueRealtimeController,
  deliveryPriority,
  formatWaitingTime,
  parseDeliveryQueuePayload,
  queryForDeliveryFilters,
  type DeliveryConnectionStatus,
} from "./delivery-display";

const restaurantId = "30000000-0000-4000-8000-000000000001";

function queueOrder(
  id = "41000000-0000-4000-8000-000000000001",
  readyAt = "2026-09-01T10:00:00.000Z",
) {
  return {
    id,
    restaurantId,
    orderNumber: `ORD-${id.slice(-1)}`,
    status: "READY",
    serviceLocation: {
      id: "31000000-0000-4000-8000-000000000001",
      name: "Mesa 1",
      type: "TABLE",
    },
    createdAt: "2026-09-01T09:30:00.000Z",
    readyAt,
    waitingTimeSeconds: 300,
    productCount: 2,
    specialObservations: ["Sin picante"],
  };
}

function message(eventName: RealtimeEventName): RealtimeMessage {
  return {
    eventName,
    envelope: {
      version: 1,
      occurredAt: "2026-09-01T10:00:00.000Z",
      restaurantId,
      entityId: "41000000-0000-4000-8000-000000000001",
      entityType: "order",
      data: {},
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("delivery display presentation", () => {
  it("uses configured warning and critical boundaries inclusively", () => {
    const readyAt = "2026-09-01T10:00:00.000Z";
    const thresholds = { warningMinutes: 5, criticalMinutes: 8 };

    expect(
      deliveryPriority(
        readyAt,
        Date.parse("2026-09-01T10:04:59.999Z"),
        thresholds,
      ),
    ).toBe("normal");
    expect(
      deliveryPriority(
        readyAt,
        Date.parse("2026-09-01T10:05:00.000Z"),
        thresholds,
      ),
    ).toBe("warning");
    expect(
      deliveryPriority(
        readyAt,
        Date.parse("2026-09-01T10:08:00.000Z"),
        thresholds,
      ),
    ).toBe("critical");
    expect(formatWaitingTime(3_723_000)).toBe("1 h 02 min 03 s");
  });

  it("validates untrusted Ready-only data and restores ready-time ordering", () => {
    const later = queueOrder(
      "41000000-0000-4000-8000-000000000002",
      "2026-09-01T10:01:00.000Z",
    );
    const earlier = queueOrder();

    expect(
      parseDeliveryQueuePayload({ orders: [later, earlier] })?.map(
        ({ id }) => id,
      ),
    ).toEqual([earlier.id, later.id]);
    expect(
      parseDeliveryQueuePayload({
        orders: [{ ...earlier, status: "PENDING" }],
      }),
    ).toBeNull();
    expect(
      parseDeliveryQueuePayload({
        orders: [{ ...earlier, restaurantId: "bad" }],
      }),
    ).toBeNull();
  });

  it("maps valid location, order, and wait filters to the stable API query", () => {
    expect(
      queryForDeliveryFilters({
        serviceLocationId: "31000000-0000-4000-8000-000000000001",
        orderNumber: " ORD-42 ",
        minimumWaitingMinutes: "5",
      }),
    ).toBe(
      "?serviceLocationId=31000000-0000-4000-8000-000000000001&orderNumber=ORD-42&minimumWaitingMinutes=5",
    );
    expect(
      queryForDeliveryFilters({
        serviceLocationId: "",
        orderNumber: "",
        minimumWaitingMinutes: "01",
      }),
    ).toBeNull();
  });
});

describe("DeliveryQueueRealtimeController", () => {
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
    const controller = new DeliveryQueueRealtimeController({
      subscriber,
      restaurantIds: [restaurantId],
      refreshQueue,
      onStatus: vi.fn(),
    });

    await controller.start();
    request!.onMessage(message("kitchen.status.updated"));
    await vi.advanceTimersByTimeAsync(999);

    expect(refreshQueue).toHaveBeenCalledTimes(2);
    expect(displayedOrderCount).toBe(1);
    await controller.stop();
  });

  it("refetches applicable delivery events on the delivery topic", async () => {
    const requests: RealtimeSubscriptionRequest[] = [];
    const subscriber: RealtimeSubscriber = {
      subscribe: vi.fn(async (request) => {
        requests.push(request);
        return { unsubscribe: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    const refreshQueue = vi.fn().mockResolvedValue(undefined);
    const controller = new DeliveryQueueRealtimeController({
      subscriber,
      restaurantIds: [restaurantId],
      refreshQueue,
      onStatus: vi.fn(),
    });

    await controller.start();
    for (const [index, eventName] of [
      "kitchen.status.updated",
      "order.cancelled",
      "delivery.status.updated",
    ].entries()) {
      requests[0]!.onMessage(message(eventName as RealtimeEventName));
      await vi.waitFor(() =>
        expect(refreshQueue).toHaveBeenCalledTimes(index + 2),
      );
    }
    requests[0]!.onMessage(message("order.created"));
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId, topic: "delivery" }),
    );
    expect(refreshQueue).toHaveBeenCalledTimes(4);

    await controller.stop();
  });

  it("keeps periodic authorized refreshes after realtime failure", async () => {
    vi.useFakeTimers();
    let request: RealtimeSubscriptionRequest | undefined;
    const subscriber: RealtimeSubscriber = {
      subscribe: vi.fn(async (candidate) => {
        request = candidate;
        return { unsubscribe: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    const refreshQueue = vi.fn().mockResolvedValue(undefined);
    const statuses: DeliveryConnectionStatus[] = [];
    const controller = new DeliveryQueueRealtimeController({
      subscriber,
      restaurantIds: [restaurantId],
      refreshQueue,
      onStatus: (status) => statuses.push(status),
    });

    await controller.start();
    request!.onTerminalFailure?.({ code: "REALTIME_SUBSCRIPTION_TERMINATED" });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(refreshQueue).toHaveBeenCalledTimes(3);
    expect(statuses.at(-1)).toBe("degraded");
    await controller.stop();
  });

  it("enters polling mode after an API error and restores live status on recovery", async () => {
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
    const statuses: DeliveryConnectionStatus[] = [];
    const controller = new DeliveryQueueRealtimeController({
      subscriber,
      restaurantIds: [restaurantId],
      refreshQueue,
      onStatus: (status) => statuses.push(status),
    });

    await controller.start();
    request!.onMessage(message("kitchen.status.updated"));
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("degraded");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(statuses.at(-1)).toBe("live");
    await controller.stop();
  });
});
