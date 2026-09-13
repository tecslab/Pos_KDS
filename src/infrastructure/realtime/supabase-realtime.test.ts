import type { RealtimeChannel } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  mapDomainEventToRealtime,
  type RealtimeDomainEvent,
  type RealtimeEventName,
  type RealtimeMessage,
} from "../../application";

import type { SupabaseRealtimeClient } from "./supabase-realtime-client";
import { SupabaseRealtimePublisher } from "./supabase-realtime-publisher";
import { SupabaseRealtimeSubscriber } from "./supabase-realtime-subscriber";

const restaurantId = "10000000-0000-4000-8000-000000000001";

function event(type: RealtimeEventName): RealtimeDomainEvent {
  return {
    type,
    occurredAt: "2026-08-18T19:00:00.000Z",
    payload: {
      restaurantId,
      entityId: "entity-1",
      entityType: "order",
      data: { status: "PENDING" },
    },
  };
}

type SubscribeCallback = (status: string, error?: Error) => void;
type BroadcastCallback = (message: unknown) => void;

class FakeChannel {
  readonly httpSend = vi
    .fn<
      (
        eventName: string,
        payload: unknown,
      ) => Promise<Readonly<{ success: true }>>
    >()
    .mockResolvedValue({ success: true });
  private subscribeCallback: SubscribeCallback | undefined;
  private broadcastCallback: BroadcastCallback | undefined;

  on(
    _type: string,
    _filter: Readonly<{ event: string }>,
    callback: BroadcastCallback,
  ): this {
    this.broadcastCallback = callback;
    return this;
  }

  subscribe(callback: SubscribeCallback): this {
    this.subscribeCallback = callback;
    return this;
  }

  emitStatus(status: string, error?: Error) {
    this.subscribeCallback?.(status, error);
  }

  emitBroadcast(message: unknown) {
    this.broadcastCallback?.(message);
  }
}

function fakeClient(
  channelFactory: () => FakeChannel = () => new FakeChannel(),
  removeResult: "ok" | "error" | "timed out" = "ok",
) {
  const channels: FakeChannel[] = [];
  const channel =
    vi.fn<(topic: string, options?: unknown) => RealtimeChannel>();
  channel.mockImplementation(() => {
    const created = channelFactory();
    channels.push(created);
    return created as unknown as RealtimeChannel;
  });
  const removeChannel = vi
    .fn<(channel: RealtimeChannel) => Promise<"ok" | "error" | "timed out">>()
    .mockResolvedValue(removeResult);
  const getChannels = vi.fn((): RealtimeChannel[] => []);
  const client = {
    channel,
    getChannels,
    removeChannel,
  } as unknown as SupabaseRealtimeClient;

  return { channel, channels, client, getChannels, removeChannel };
}

describe("SupabaseRealtimePublisher", () => {
  it("records safe publication health while preserving success and failure", async () => {
    const successRecord = vi.fn();
    const success = fakeClient();
    await new SupabaseRealtimePublisher(
      success.client,
      { record: successRecord },
      { now: vi.fn().mockReturnValueOnce(3).mockReturnValueOnce(8) },
    ).publish([event("inventory.alert")]);
    expect(successRecord).toHaveBeenCalledWith({
      event: "realtime.operation",
      operation: "publish",
      outcome: "success",
      durationMs: 5,
    });
    expect(JSON.stringify(successRecord.mock.calls)).not.toContain(
      restaurantId,
    );

    const failureRecord = vi.fn();
    const failure = fakeClient(() => {
      const channel = new FakeChannel();
      channel.httpSend.mockRejectedValue(
        Object.assign(new Error("private payload"), { code: "ETIMEDOUT" }),
      );
      return channel;
    });
    await expect(
      new SupabaseRealtimePublisher(
        failure.client,
        { record: failureRecord },
        { now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(12) },
      ).publish([event("inventory.alert")]),
    ).rejects.toThrow("private payload");
    expect(failureRecord).toHaveBeenCalledWith({
      event: "realtime.operation",
      operation: "publish",
      outcome: "failure",
      durationMs: 2,
      errorClass: "TIMEOUT",
    });
    expect(JSON.stringify(failureRecord.mock.calls)).not.toContain(
      "private payload",
    );
  });

  it("publishes fan-out sequentially to private topics in stable order", async () => {
    const activity: string[] = [];
    const fake = fakeClient(() => {
      const created = new FakeChannel();
      created.httpSend.mockImplementation(async (eventName) => {
        activity.push(`send:${eventName}`);
        return { success: true };
      });
      return created;
    });
    fake.channel.mockImplementation((topic) => {
      activity.push(`channel:${topic}`);
      const created = new FakeChannel();
      created.httpSend.mockImplementation(async (eventName) => {
        activity.push(`send:${eventName}`);
        return { success: true };
      });
      fake.channels.push(created);
      return created as unknown as RealtimeChannel;
    });
    fake.removeChannel.mockImplementation(async () => {
      activity.push("remove");
      return "ok";
    });
    const publisher = new SupabaseRealtimePublisher(fake.client);

    await publisher.publish([event("order.created"), event("inventory.alert")]);

    expect(activity).toEqual([
      `channel:restaurant:${restaurantId}:orders`,
      "send:order.created",
      "remove",
      `channel:restaurant:${restaurantId}:kitchen`,
      "send:order.created",
      "remove",
      `channel:restaurant:${restaurantId}:payments`,
      "send:order.created",
      "remove",
      `channel:restaurant:${restaurantId}:inventory`,
      "send:inventory.alert",
      "remove",
    ]);
    for (const call of fake.channel.mock.calls) {
      expect(call[1]).toEqual({ config: { private: true } });
    }
  });

  it("awaits acknowledgement before cleanup and completion", async () => {
    let acknowledge: (() => void) | undefined;
    const acknowledgement = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const fake = fakeClient(() => {
      const created = new FakeChannel();
      created.httpSend.mockImplementation(async () => {
        await acknowledgement;
        return { success: true };
      });
      return created;
    });
    const publisher = new SupabaseRealtimePublisher(fake.client);
    let completed = false;

    const publishing = publisher
      .publish([event("inventory.alert")])
      .then(() => {
        completed = true;
      });
    await Promise.resolve();

    expect(completed).toBe(false);
    expect(fake.removeChannel).not.toHaveBeenCalled();
    acknowledge?.();
    await publishing;
    expect(fake.removeChannel).toHaveBeenCalledOnce();
  });

  it("propagates publication failure, cleans up, and stops later events", async () => {
    const failure = new Error("broadcast unavailable");
    const fake = fakeClient(() => {
      const created = new FakeChannel();
      created.httpSend.mockRejectedValue(failure);
      return created;
    });
    const publisher = new SupabaseRealtimePublisher(fake.client);

    await expect(
      publisher.publish([event("inventory.alert"), event("inventory.alert")]),
    ).rejects.toBe(failure);
    expect(fake.channel).toHaveBeenCalledOnce();
    expect(fake.removeChannel).toHaveBeenCalledOnce();
  });

  it("rejects invalid mapped events before creating a channel", async () => {
    const fake = fakeClient();
    const publisher = new SupabaseRealtimePublisher(fake.client);
    const invalid = {
      ...event("inventory.alert"),
      occurredAt: "not-an-instant",
    };

    await expect(publisher.publish([invalid])).rejects.toThrow(
      "Invalid realtime domain event.",
    );
    expect(fake.channel).not.toHaveBeenCalled();
  });

  it("publishes through an existing private channel without removing it", async () => {
    const fake = fakeClient();
    const existing = Object.assign(new FakeChannel(), {
      topic: `realtime:restaurant:${restaurantId}:inventory`,
      private: true,
    }) as unknown as RealtimeChannel;
    fake.getChannels.mockReturnValue([existing]);
    fake.channel.mockReturnValue(existing);
    const publisher = new SupabaseRealtimePublisher(fake.client);

    await publisher.publish([event("inventory.alert")]);

    expect(fake.removeChannel).not.toHaveBeenCalled();
  });
});

describe("SupabaseRealtimeSubscriber", () => {
  it("records subscription readiness without restaurant or topic data", async () => {
    const record = vi.fn();
    const fake = fakeClient();
    const subscriber = new SupabaseRealtimeSubscriber(
      fake.client,
      { record },
      { now: vi.fn().mockReturnValueOnce(2).mockReturnValueOnce(9) },
    );
    const pending = subscriber.subscribe({
      restaurantId,
      topic: "payments",
      onMessage: vi.fn(),
    });
    fake.channels[0]!.emitStatus("SUBSCRIBED");
    const subscription = await pending;

    expect(record).toHaveBeenCalledWith({
      event: "realtime.operation",
      operation: "subscribe",
      outcome: "success",
      durationMs: 7,
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain(restaurantId);
    expect(JSON.stringify(record.mock.calls)).not.toContain("payments");
    await subscription.unsubscribe();
  });

  it("waits for readiness, validates messages, and removes exactly once", async () => {
    const fake = fakeClient();
    const subscriber = new SupabaseRealtimeSubscriber(fake.client);
    const messages: RealtimeMessage[] = [];
    let ready = false;

    const subscribing = subscriber
      .subscribe({
        restaurantId,
        topic: "orders",
        onMessage: (message) => messages.push(message),
      })
      .then((subscription) => {
        ready = true;
        return subscription;
      });
    await Promise.resolve();

    expect(ready).toBe(false);
    expect(fake.channel).toHaveBeenCalledWith(
      `restaurant:${restaurantId}:orders`,
      { config: { private: true } },
    );
    fake.channels[0]!.emitStatus("SUBSCRIBED");
    const subscription = await subscribing;
    const mapped = mapDomainEventToRealtime(event("order.created"));

    if (!mapped.ok) {
      throw new Error("expected mapping to succeed");
    }

    fake.channels[0]!.emitBroadcast({
      event: "order.created",
      payload: mapped.value[0]!.envelope,
    });
    fake.channels[0]!.emitBroadcast({
      event: "order.created",
      payload: { ...mapped.value[0]!.envelope, version: 2 },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.eventName).toBe("order.created");
    const firstRemoval = subscription.unsubscribe();
    const secondRemoval = subscription.unsubscribe();
    expect(firstRemoval).toBe(secondRemoval);
    await firstRemoval;
    expect(fake.removeChannel).toHaveBeenCalledOnce();
  });

  it.each(["TIMED_OUT", "CHANNEL_ERROR", "CLOSED"])(
    "rejects %s before readiness and cleans up",
    async (status) => {
      const fake = fakeClient();
      const subscriber = new SupabaseRealtimeSubscriber(fake.client);
      const subscribing = subscriber.subscribe({
        restaurantId,
        topic: "delivery",
        onMessage: vi.fn(),
      });
      const failure = new Error("join failed");

      fake.channels[0]!.emitStatus(status, failure);

      await expect(subscribing).rejects.toBe(failure);
      expect(fake.removeChannel).toHaveBeenCalledOnce();
    },
  );

  it("rejects invalid subscription inputs before creating a channel", async () => {
    const fake = fakeClient();
    const subscriber = new SupabaseRealtimeSubscriber(fake.client);

    await expect(
      subscriber.subscribe({
        restaurantId: "restaurant-1",
        topic: "orders",
        onMessage: vi.fn(),
      }),
    ).rejects.toThrow("Invalid realtime subscription.");
    expect(fake.channel).not.toHaveBeenCalled();
  });

  it("shares a topic and removes it only after the last subscriber leaves", async () => {
    const fake = fakeClient();
    const subscriber = new SupabaseRealtimeSubscriber(fake.client);
    const firstHandler = vi.fn(() => {
      throw new Error("consumer failed");
    });
    const secondHandler = vi.fn();
    const firstPending = subscriber.subscribe({
      restaurantId,
      topic: "inventory",
      onMessage: firstHandler,
    });
    const secondPending = subscriber.subscribe({
      restaurantId,
      topic: "inventory",
      onMessage: secondHandler,
    });

    expect(fake.channel).toHaveBeenCalledOnce();
    fake.channels[0]!.emitStatus("SUBSCRIBED");
    const [first, second] = await Promise.all([firstPending, secondPending]);
    const mapped = mapDomainEventToRealtime(event("inventory.alert"));

    if (!mapped.ok) {
      throw new Error("expected mapping to succeed");
    }

    expect(() =>
      fake.channels[0]!.emitBroadcast({
        event: "inventory.alert",
        payload: mapped.value[0]!.envelope,
      }),
    ).not.toThrow();
    expect(firstHandler).toHaveBeenCalledOnce();
    expect(secondHandler).toHaveBeenCalledOnce();

    await first.unsubscribe();
    expect(fake.removeChannel).not.toHaveBeenCalled();
    await second.unsubscribe();
    expect(fake.removeChannel).toHaveBeenCalledOnce();
  });

  it.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])(
    "recovers registrations after post-readiness %s",
    async (status) => {
      const fake = fakeClient();
      const subscriber = new SupabaseRealtimeSubscriber(fake.client);
      const handler = vi.fn();
      const pending = subscriber.subscribe({
        restaurantId,
        topic: "orders",
        onMessage: handler,
      });
      fake.channels[0]!.emitStatus("SUBSCRIBED");
      const subscription = await pending;

      fake.channels[0]!.emitStatus(status);
      await vi.waitFor(() => expect(fake.channels).toHaveLength(2));
      fake.channels[1]!.emitStatus("SUBSCRIBED");
      const mapped = mapDomainEventToRealtime(event("order.modified"));

      if (!mapped.ok) {
        throw new Error("expected mapping to succeed");
      }

      fake.channels[1]!.emitBroadcast({
        event: "order.modified",
        payload: mapped.value[0]!.envelope,
      });
      expect(handler).toHaveBeenCalledOnce();
      expect(fake.removeChannel).toHaveBeenCalledTimes(1);

      await subscription.unsubscribe();
      expect(fake.removeChannel).toHaveBeenCalledTimes(2);
    },
  );

  it("reports a provider-neutral terminal failure when recovery cannot join", async () => {
    const fake = fakeClient();
    const subscriber = new SupabaseRealtimeSubscriber(fake.client);
    const onTerminalFailure = vi.fn();
    const pending = subscriber.subscribe({
      restaurantId,
      topic: "delivery",
      onMessage: vi.fn(),
      onTerminalFailure,
    });
    fake.channels[0]!.emitStatus("SUBSCRIBED");
    await pending;

    fake.channels[0]!.emitStatus("CLOSED");
    await vi.waitFor(() => expect(fake.channels).toHaveLength(2));
    fake.channels[1]!.emitStatus("CHANNEL_ERROR");
    await vi.waitFor(() => expect(onTerminalFailure).toHaveBeenCalledOnce());

    expect(onTerminalFailure).toHaveBeenCalledWith({
      code: "REALTIME_SUBSCRIPTION_TERMINATED",
    });
    expect(Object.isFrozen(onTerminalFailure.mock.calls[0]?.[0])).toBe(true);
  });
});
