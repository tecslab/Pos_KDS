import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { DomainEvent } from "../../domain";

import { InProcessDomainEventPublisher } from "./in-process-domain-event-publisher";

type OrderPlaced = DomainEvent<"order.placed", Readonly<{ orderId: string }>>;
type OrderPaid = DomainEvent<"order.paid", Readonly<{ paymentId: string }>>;
type TestEvent = OrderPlaced | OrderPaid;

const placed = (orderId: string): OrderPlaced => ({
  type: "order.placed",
  occurredAt: "2026-08-15T12:00:00.000Z",
  payload: { orderId },
});

const paid = (paymentId: string): OrderPaid => ({
  type: "order.paid",
  occurredAt: "2026-08-15T12:01:00.000Z",
  payload: { paymentId },
});

describe("InProcessDomainEventPublisher", () => {
  it("records type-and-count metrics for each committed event before post-commit dispatch", async () => {
    const record = vi.fn();
    const publisher = new InProcessDomainEventPublisher<TestEvent>({ record });
    publisher.subscribe("order.placed", vi.fn());

    await publisher.publish([placed("private-order-id")]);

    expect(record).toHaveBeenCalledWith({
      event: "business_event.published",
      eventType: "order.placed",
      count: 1,
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain("private-order-id");
  });

  it("keeps committed metrics when a post-commit handler fails and isolates telemetry failure", async () => {
    const failedRecord = vi.fn();
    const failed = new InProcessDomainEventPublisher<TestEvent>({
      record: failedRecord,
    });
    failed.subscribe("order.placed", () => {
      throw new Error("handler failed");
    });
    await expect(failed.publish([placed("order-1")])).rejects.toThrow(
      "handler failed",
    );
    expect(failedRecord).toHaveBeenCalledWith({
      event: "business_event.published",
      eventType: "order.placed",
      count: 1,
    });

    const isolated = new InProcessDomainEventPublisher<TestEvent>({
      record() {
        throw new Error("telemetry failed");
      },
    });
    await expect(
      isolated.publish([paid("payment-1")]),
    ).resolves.toBeUndefined();
  });

  it("dispatches FIFO events to matching handlers in registration order", async () => {
    const activity: string[] = [];
    const publisher = new InProcessDomainEventPublisher<TestEvent>();

    publisher.subscribe("order.placed", async (event) => {
      expectTypeOf(event).toEqualTypeOf<OrderPlaced>();
      activity.push(`first:${event.payload.orderId}`);
    });
    publisher.subscribe("order.placed", (event) => {
      activity.push(`second:${event.payload.orderId}`);
    });
    publisher.subscribe("order.paid", (event) => {
      expectTypeOf(event).toEqualTypeOf<OrderPaid>();
      activity.push(`paid:${event.payload.paymentId}`);
    });

    await publisher.publish([
      placed("order-1"),
      paid("payment-1"),
      placed("order-2"),
    ]);

    expect(activity).toEqual([
      "first:order-1",
      "second:order-1",
      "paid:payment-1",
      "first:order-2",
      "second:order-2",
    ]);
  });

  it("waits for each handler before dispatching the next one", async () => {
    const activity: string[] = [];
    const publisher = new InProcessDomainEventPublisher<TestEvent>();

    publisher.subscribe("order.placed", async () => {
      activity.push("first:start");
      await Promise.resolve();
      activity.push("first:end");
    });
    publisher.subscribe("order.placed", () => {
      activity.push("second");
    });

    await publisher.publish([placed("order-1")]);

    expect(activity).toEqual(["first:start", "first:end", "second"]);
  });

  it("propagates handler failures and stops inline dispatch", async () => {
    const activity: string[] = [];
    const publisher = new InProcessDomainEventPublisher<TestEvent>();
    const failure = new Error("subscriber failed");

    publisher.subscribe("order.placed", () => {
      activity.push("failing-handler");
      throw failure;
    });
    publisher.subscribe("order.placed", () => {
      activity.push("later-handler");
    });

    await expect(
      publisher.publish([placed("order-1"), paid("payment-1")]),
    ).rejects.toBe(failure);
    expect(activity).toEqual(["failing-handler"]);
  });
});
