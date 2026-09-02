import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { err, ok, type OrderOnTheWay, type Result } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { TransactionBoundary } from "../transaction-boundary";
import { TransactionalOperationRunner } from "../transactional-operation-runner";
import {
  OrderOnTheWayService,
  type OnTheWayOrder,
  type OrderOnTheWayGateway,
} from "./order-on-the-way";

const actorId = "10000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const waiterId = "10000000-0000-4000-8000-000000000002";

const handedOff: OnTheWayOrder = Object.freeze({
  orderId,
  restaurantId,
  serviceLocationId: locationId,
  orderNumber: "ORD-42",
  assignedWaiterId: waiterId,
  previousStatus: "READY",
  status: "ON_THE_WAY",
  collectedById: actorId,
  readyAt: "2026-09-01T09:55:00.000Z",
  onTheWayAt: "2026-09-01T10:00:00.000Z",
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

function setup(
  permissions: readonly string[] = ["delivery.on_the_way.mark"],
  roleCode = "waiter",
) {
  const activity: string[] = [];
  const gateway: OrderOnTheWayGateway = {
    markOnTheWay: vi.fn().mockImplementation(async () => {
      activity.push("rpc");
      return ok(handedOff);
    }),
  };
  const published: OrderOnTheWay[] = [];
  const publisher: DomainEventPublisher<OrderOnTheWay> = {
    async publish(events) {
      activity.push("publish");
      published.push(...events);
    },
  };
  return {
    activity,
    gateway,
    published,
    service: new OrderOnTheWayService(
      {
        findByAuthenticatedUserId: vi.fn().mockResolvedValue({
          userId: actorId,
          displayName: "Ana",
          isActive: true,
          roleGrants: [{ roleCode, permissionCodes: permissions }],
        }),
      },
      gateway,
      { now: () => new Date("2026-09-01T10:00:00.000Z") },
      new TransactionalOperationRunner(new Boundary(activity), publisher),
    ),
  };
}

describe("OrderOnTheWayService", () => {
  it("defines handoff results and events as financial-data-free projections", () => {
    expectTypeOf<OnTheWayOrder>().not.toHaveProperty("totalAmount");
    expectTypeOf<OnTheWayOrder>().not.toHaveProperty("outstandingBalance");
    expectTypeOf<OnTheWayOrder>().not.toHaveProperty("paymentStatus");
    expectTypeOf<OrderOnTheWay["payload"]>().not.toHaveProperty("unitPrice");
    expect(JSON.stringify(handedOff)).not.toMatch(
      /total|price|balance|payment|amount/i,
    );
  });

  it.each(["administrator", "waiter", "custom-runner"])(
    "authorizes %s through the centralized permission and publishes only after commit",
    async (roleCode) => {
      const { activity, gateway, published, service } = setup(
        ["delivery.on_the_way.mark"],
        roleCode,
      );
      await expect(
        service.markOnTheWay(actorId, {
          orderId,
          sourceIp: " 192.0.2.52 ",
        }),
      ).resolves.toEqual(ok(handedOff));
      expect(gateway.markOnTheWay).toHaveBeenCalledWith({
        actorId,
        orderId,
        sourceIp: "192.0.2.52",
        occurredAt: "2026-09-01T10:00:00.000Z",
      });
      expect(activity).toEqual([
        "transaction:start",
        "rpc",
        "transaction:commit",
        "publish",
      ]);
      expect(published).toEqual([
        {
          type: "order.on-the-way",
          occurredAt: handedOff.onTheWayAt,
          payload: handedOff,
        },
      ]);
    },
  );

  it("fails closed without delivery.on_the_way.mark", async () => {
    const { gateway, published, service } = setup([], "administrator");
    await expect(
      service.markOnTheWay(actorId, { orderId }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
    expect(gateway.markOnTheWay).not.toHaveBeenCalled();
    expect(published).toEqual([]);
  });

  it.each([
    { orderId: "not-a-uuid" },
    { orderId, sourceIp: 42 as unknown as string },
    { orderId, sourceIp: "x".repeat(65) },
  ])("rejects invalid transition input", async (input) => {
    const { gateway, service } = setup();
    await expect(service.markOnTheWay(actorId, input)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_ON_THE_WAY_TRANSITION" },
    });
    expect(gateway.markOnTheWay).not.toHaveBeenCalled();
  });

  it("records no event when persistence rejects a non-Ready or duplicate transition", async () => {
    const { activity, gateway, published, service } = setup();
    vi.mocked(gateway.markOnTheWay).mockResolvedValueOnce(
      err({ kind: "order-on-the-way-error", code: "ORDER_NOT_READY" }),
    );
    await expect(
      service.markOnTheWay(actorId, { orderId }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ORDER_NOT_READY" },
    });
    expect(activity).toEqual(["transaction:start", "transaction:rollback"]);
    expect(published).toEqual([]);
  });
});
