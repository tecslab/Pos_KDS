import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { err, ok, type OrderReady, type Result } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { TransactionBoundary } from "../transaction-boundary";
import { TransactionalOperationRunner } from "../transactional-operation-runner";
import {
  OrderReadyService,
  type OrderReadyGateway,
  type ReadyOrder,
} from "./order-ready";

const actorId = "10000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const waiterId = "10000000-0000-4000-8000-000000000002";

const ready: ReadyOrder = Object.freeze({
  orderId,
  restaurantId,
  serviceLocationId: locationId,
  orderNumber: "ORD-42",
  assignedWaiterId: waiterId,
  previousStatus: "PENDING",
  status: "READY",
  markedReadyById: actorId,
  readyAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
});

class Boundary implements TransactionBoundary {
  constructor(private readonly activity: string[]) {}
  async run<T, E>(work: () => Promise<Result<T, E>>) {
    this.activity.push("transaction:start");
    const result = await work();
    this.activity.push(
      result.ok ? "transaction:commit" : "transaction:rollback",
    );
    return result;
  }
}

function setup(permissions: readonly string[] = ["kitchen.ready.mark"]) {
  const activity: string[] = [];
  const gateway: OrderReadyGateway = {
    markReady: vi.fn().mockImplementation(async () => {
      activity.push("rpc");
      return ok(ready);
    }),
  };
  const published: OrderReady[] = [];
  const publisher: DomainEventPublisher<OrderReady> = {
    async publish(events) {
      activity.push("publish");
      published.push(...events);
    },
  };
  return {
    activity,
    gateway,
    published,
    service: new OrderReadyService(
      {
        findByAuthenticatedUserId: vi.fn().mockResolvedValue({
          userId: actorId,
          displayName: "Ana",
          isActive: true,
          roleGrants: [{ roleCode: "kitchen", permissionCodes: permissions }],
        }),
      },
      gateway,
      { now: () => new Date("2026-09-01T10:00:00.000Z") },
      new TransactionalOperationRunner(new Boundary(activity), publisher),
    ),
  };
}

describe("OrderReadyService", () => {
  it("defines Ready results and events as financial-data-free projections", () => {
    expectTypeOf<ReadyOrder>().not.toHaveProperty("totalAmount");
    expectTypeOf<ReadyOrder>().not.toHaveProperty("outstandingBalance");
    expectTypeOf<ReadyOrder>().not.toHaveProperty("paymentStatus");
    expectTypeOf<ReadyOrder>().not.toHaveProperty("unitPrice");
    expectTypeOf<OrderReady["payload"]>().not.toHaveProperty("totalAmount");
    expectTypeOf<OrderReady["payload"]>().not.toHaveProperty(
      "outstandingBalance",
    );
    expectTypeOf<OrderReady["payload"]>().not.toHaveProperty("paymentStatus");
    expectTypeOf<OrderReady["payload"]>().not.toHaveProperty("unitPrice");
    expect(Object.keys(ready)).not.toEqual(
      expect.arrayContaining([
        "totalAmount",
        "outstandingBalance",
        "paymentStatus",
        "unitPrice",
      ]),
    );
  });

  it("authorizes, normalizes, and publishes OrderReady only after commit", async () => {
    const { activity, gateway, published, service } = setup();
    await expect(
      service.markReady(actorId, { orderId, sourceIp: " 192.0.2.49 " }),
    ).resolves.toEqual(ok(ready));
    expect(gateway.markReady).toHaveBeenCalledWith({
      actorId,
      orderId,
      sourceIp: "192.0.2.49",
      occurredAt: "2026-09-01T10:00:00.000Z",
    });
    expect(activity).toEqual([
      "transaction:start",
      "rpc",
      "transaction:commit",
      "publish",
    ]);
    expect(published).toEqual([
      { type: "order.ready", occurredAt: ready.readyAt, payload: ready },
    ]);
    expect(JSON.stringify(published)).not.toMatch(
      /total|price|balance|payment|amount/i,
    );
  });

  it("fails closed without kitchen.ready.mark", async () => {
    const { gateway, published, service } = setup([]);
    await expect(
      service.markReady(actorId, { orderId }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
    expect(gateway.markReady).not.toHaveBeenCalled();
    expect(published).toEqual([]);
  });

  it.each([
    { orderId: "not-a-uuid" },
    { orderId, sourceIp: 42 as unknown as string },
    { orderId, sourceIp: "x".repeat(65) },
  ])("rejects invalid transition input", async (input) => {
    const { gateway, service } = setup();
    await expect(service.markReady(actorId, input)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_READY_TRANSITION" },
    });
    expect(gateway.markReady).not.toHaveBeenCalled();
  });

  it("records no event when persistence rejects the transition", async () => {
    const { activity, gateway, published, service } = setup();
    vi.mocked(gateway.markReady).mockResolvedValueOnce(
      err({ kind: "order-ready-error", code: "ORDER_NOT_PENDING" }),
    );
    await expect(
      service.markReady(actorId, { orderId }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ORDER_NOT_PENDING" },
    });
    expect(activity).toEqual(["transaction:start", "transaction:rollback"]);
    expect(published).toEqual([]);
  });
});
