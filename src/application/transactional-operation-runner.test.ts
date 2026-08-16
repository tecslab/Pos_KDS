import { describe, expect, it, vi } from "vitest";

import { err, ok, type DomainEvent, type Result } from "../domain";

import type { DomainEventPublisher } from "./domain-event-publisher";
import type { TransactionBoundary } from "./transaction-boundary";
import { TransactionalOperationRunner } from "./transactional-operation-runner";

type TestEvent = DomainEvent<
  "test.completed" | "test.rejected",
  Readonly<{ operationId: string }>
>;

const event = (type: TestEvent["type"], operationId: string): TestEvent => ({
  type,
  occurredAt: "2026-08-15T12:00:00.000Z",
  payload: { operationId },
});

class RecordingTransactionBoundary implements TransactionBoundary {
  constructor(private readonly activity: string[]) {}

  async run<T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    this.activity.push("transaction:start");

    try {
      const result = await work();
      this.activity.push(
        result.ok ? "transaction:commit" : "transaction:rollback",
      );
      return result;
    } catch (error) {
      this.activity.push("transaction:rollback");
      throw error;
    }
  }
}

const publisherFor = (activity: string[]): DomainEventPublisher<TestEvent> => ({
  async publish(events) {
    activity.push(
      `publish:${events.map(({ payload }) => payload.operationId).join(",")}`,
    );
  },
});

describe("TransactionalOperationRunner", () => {
  it("commits before publishing buffered events", async () => {
    const activity: string[] = [];
    const runner = new TransactionalOperationRunner(
      new RecordingTransactionBoundary(activity),
      publisherFor(activity),
    );

    const result = await runner.run(async (events) => {
      activity.push("operation");
      events.record(event("test.completed", "one"));
      events.record(event("test.completed", "two"));
      return ok("saved");
    });

    expect(result).toEqual(ok("saved"));
    expect(activity).toEqual([
      "transaction:start",
      "operation",
      "transaction:commit",
      "publish:one,two",
    ]);
  });

  it("rolls back an Err result without publishing", async () => {
    const activity: string[] = [];
    const publish = vi.fn<DomainEventPublisher<TestEvent>["publish"]>();
    const runner = new TransactionalOperationRunner(
      new RecordingTransactionBoundary(activity),
      { publish },
    );

    const result = await runner.run(async (events) => {
      events.record(event("test.rejected", "failed"));
      return err("invalid-operation" as const);
    });

    expect(result).toEqual(err("invalid-operation"));
    expect(activity).toEqual(["transaction:start", "transaction:rollback"]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("propagates rejected work without publishing", async () => {
    const activity: string[] = [];
    const publish = vi.fn<DomainEventPublisher<TestEvent>["publish"]>();
    const runner = new TransactionalOperationRunner(
      new RecordingTransactionBoundary(activity),
      { publish },
    );
    const failure = new Error("database unavailable");

    await expect(
      runner.run(async (events) => {
        events.record(event("test.rejected", "rejected"));
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(activity).toEqual(["transaction:start", "transaction:rollback"]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not call the publisher when no events were recorded", async () => {
    const activity: string[] = [];
    const publish = vi.fn<DomainEventPublisher<TestEvent>["publish"]>();
    const runner = new TransactionalOperationRunner(
      new RecordingTransactionBoundary(activity),
      { publish },
    );

    await runner.run(async () => ok("saved"));

    expect(activity).toEqual(["transaction:start", "transaction:commit"]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("propagates publishing failure after the transaction commits", async () => {
    const activity: string[] = [];
    const failure = new Error("handler failed");
    const runner = new TransactionalOperationRunner<TestEvent>(
      new RecordingTransactionBoundary(activity),
      {
        async publish() {
          activity.push("publish");
          throw failure;
        },
      },
    );

    await expect(
      runner.run(async (events) => {
        events.record(event("test.completed", "committed"));
        return ok("saved");
      }),
    ).rejects.toBe(failure);
    expect(activity).toEqual([
      "transaction:start",
      "transaction:commit",
      "publish",
    ]);
  });

  it("isolates event buffers between concurrent operations", async () => {
    const published: string[][] = [];
    const runner = new TransactionalOperationRunner<TestEvent>(
      new RecordingTransactionBoundary([]),
      {
        async publish(events) {
          published.push(events.map(({ payload }) => payload.operationId));
        },
      },
    );
    let releaseFirst: (() => void) | undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runner.run(async (events) => {
      events.record(event("test.completed", "first"));
      await firstCanFinish;
      return ok("first");
    });
    const second = runner.run(async (events) => {
      events.record(event("test.rejected", "second"));
      return err("failed" as const);
    });

    await second;
    releaseFirst?.();
    await first;

    expect(published).toEqual([["first"]]);
  });
});
