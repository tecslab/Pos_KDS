import { describe, expect, it } from "vitest";

import type { RealtimeDomainEvent, RealtimeEventName } from "./realtime-event";
import {
  mapDomainEventToRealtime,
  parseRealtimeMessage,
  realtimeTopicName,
} from "./realtime-event-mapper";

const restaurantId = "10000000-0000-4000-8000-000000000001";

function event(
  type: RealtimeEventName,
  data: Readonly<Record<string, never>> = {},
): RealtimeDomainEvent {
  return {
    type,
    occurredAt: "2026-08-18T19:00:00.000Z",
    payload: {
      restaurantId,
      entityId: "entity:natural-id",
      entityType: "order",
      data,
    },
  };
}

describe("realtime event mapping", () => {
  it.each([
    ["order.created", ["orders", "kitchen"]],
    ["order.modified", ["orders", "kitchen"]],
    ["order.cancelled", ["orders", "kitchen", "delivery"]],
    ["kitchen.status.updated", ["kitchen", "orders", "delivery"]],
    ["delivery.status.updated", ["delivery", "orders"]],
    ["payment.completed", ["payments", "orders"]],
    ["inventory.alert", ["inventory"]],
  ] as const)("maps %s to stable deterministic topics", (type, topics) => {
    const result = mapDomainEventToRealtime(event(type));

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.map(({ topic }) => topic)).toEqual(topics);
    expect(result.ok && result.value.map(({ eventName }) => eventName)).toEqual(
      topics.map(() => type),
    );
    expect(
      result.ok && result.value.every(({ envelope }) => envelope.version === 1),
    ).toBe(true);
  });

  it("creates the documented private topic name", () => {
    expect(realtimeTopicName(restaurantId, "kitchen")).toBe(
      `restaurant:${restaurantId}:kitchen`,
    );
    expect(realtimeTopicName("not-a-uuid", "kitchen")).toBeNull();
    expect(realtimeTopicName(restaurantId, "unknown" as "kitchen")).toBeNull();
  });

  it("detaches and deeply freezes minimal event data", () => {
    const data = { status: "READY", basketIds: ["basket-1"] };
    const result = mapDomainEventToRealtime(
      event("kitchen.status.updated", data as never),
    );

    if (!result.ok) {
      throw new Error("expected mapping to succeed");
    }

    const { envelope } = result.value[0]!;
    expect(envelope.data).toEqual(data);
    expect(envelope.data).not.toBe(data);
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.data)).toBe(true);
    expect(Object.isFrozen(envelope.data.basketIds)).toBe(true);

    data.status = "DELIVERED";
    data.basketIds.push("basket-2");
    expect(envelope.data).toEqual({
      status: "READY",
      basketIds: ["basket-1"],
    });
  });

  it.each([
    ["unsupported event", { type: "order.unknown" }],
    ["invalid timestamp", { occurredAt: "yesterday" }],
    ["noncanonical timestamp", { occurredAt: "2026-08-18T19:00:00Z" }],
    ["invalid restaurant", { payload: { restaurantId: "restaurant-1" } }],
    ["blank entity identifier", { payload: { entityId: "  " } }],
    ["blank entity type", { payload: { entityType: "" } }],
    ["nonfinite data", { payload: { data: { value: Number.NaN } } }],
    ["non-plain data", { payload: { data: new Date() } }],
  ])("rejects %s", (_label, override) => {
    const original = event("order.created") as unknown as Record<
      string,
      unknown
    >;
    const overridden = {
      ...original,
      ...override,
      payload: {
        ...(original.payload as Record<string, unknown>),
        ...((override as Record<string, unknown>).payload as
          Record<string, unknown> | undefined),
      },
    } as RealtimeDomainEvent;

    expect(mapDomainEventToRealtime(overridden)).toEqual({
      ok: false,
      error: {
        kind: "realtime-mapping-error",
        code: "INVALID_REALTIME_EVENT",
      },
    });
  });

  it("rejects cyclic data", () => {
    const data: Record<string, unknown> = {};
    data.self = data;
    const realtimeEvent = event("order.modified") as unknown as {
      payload: { data: unknown };
    };
    realtimeEvent.payload.data = data;

    expect(
      mapDomainEventToRealtime(realtimeEvent as RealtimeDomainEvent).ok,
    ).toBe(false);
  });

  it("validates and freezes incoming version-1 messages", () => {
    const mapped = mapDomainEventToRealtime(event("order.cancelled"));

    if (!mapped.ok) {
      throw new Error("expected mapping to succeed");
    }

    const incoming = parseRealtimeMessage(
      "order.cancelled",
      mapped.value[0]!.envelope,
      restaurantId,
      "orders",
    );

    expect(incoming).toEqual({
      eventName: "order.cancelled",
      envelope: mapped.value[0]!.envelope,
    });
    expect(Object.isFrozen(incoming)).toBe(true);
    expect(Object.isFrozen(incoming?.envelope.data)).toBe(true);
  });

  it("drops incoming messages with the wrong route, tenant, version, or shape", () => {
    const mapped = mapDomainEventToRealtime(event("inventory.alert"));

    if (!mapped.ok) {
      throw new Error("expected mapping to succeed");
    }

    const envelope = mapped.value[0]!.envelope;
    expect(
      parseRealtimeMessage("inventory.alert", envelope, restaurantId, "orders"),
    ).toBeNull();
    expect(
      parseRealtimeMessage(
        "inventory.alert",
        envelope,
        "20000000-0000-4000-8000-000000000002",
        "inventory",
      ),
    ).toBeNull();
    expect(
      parseRealtimeMessage(
        "inventory.alert",
        { ...envelope, version: 2 },
        restaurantId,
        "inventory",
      ),
    ).toBeNull();
    expect(
      parseRealtimeMessage(
        "inventory.alert",
        { ...envelope, unexpected: true },
        restaurantId,
        "inventory",
      ),
    ).toBeNull();
    const accessorEnvelope = Object.defineProperty({ ...envelope }, "data", {
      enumerable: true,
      get: () => ({ hidden: "behavior" }),
    });
    expect(
      parseRealtimeMessage(
        "inventory.alert",
        accessorEnvelope,
        restaurantId,
        "inventory",
      ),
    ).toBeNull();
  });
});
