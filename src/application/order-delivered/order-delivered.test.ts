import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { err, ok, type OrderDelivered, type Result } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { TransactionBoundary } from "../transaction-boundary";
import { TransactionalOperationRunner } from "../transactional-operation-runner";
import {
  OrderDeliveredService,
  type DeliveredOrder,
  type OrderDeliveredGateway,
} from "./order-delivered";

const actorId = "10000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const waiterId = "10000000-0000-4000-8000-000000000002";

const delivered: DeliveredOrder = Object.freeze({
  orderId,
  restaurantId,
  serviceLocationId: locationId,
  orderNumber: "ORD-42",
  assignedWaiterId: waiterId,
  previousStatus: "ON_THE_WAY",
  status: "DELIVERED",
  deliveredById: actorId,
  readyAt: "2026-09-01T09:55:00.000Z",
  onTheWayAt: "2026-09-01T10:00:00.000Z",
  deliveredAt: "2026-09-01T10:05:00.000Z",
  updatedAt: "2026-09-01T10:05:00.000Z",
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
  permissions: readonly string[] = ["delivery.delivered.mark"],
  roleCode = "waiter",
) {
  const activity: string[] = [];
  const gateway: OrderDeliveredGateway = {
    markDelivered: vi.fn().mockImplementation(async () => {
      activity.push("rpc");
      return ok(delivered);
    }),
  };
  const published: OrderDelivered[] = [];
  const publisher: DomainEventPublisher<OrderDelivered> = {
    async publish(events) {
      activity.push("publish");
      published.push(...events);
    },
  };
  return {
    activity,
    gateway,
    published,
    service: new OrderDeliveredService(
      {
        findByAuthenticatedUserId: vi.fn().mockResolvedValue({
          userId: actorId,
          displayName: "Ana",
          isActive: true,
          roleGrants: [{ roleCode, permissionCodes: permissions }],
        }),
      },
      gateway,
      { now: () => new Date("2026-09-01T10:05:00.000Z") },
      new TransactionalOperationRunner(new Boundary(activity), publisher),
    ),
  };
}

describe("OrderDeliveredService", () => {
  it("defines delivery results and events as financial-data-free projections", () => {
    expectTypeOf<DeliveredOrder>().not.toHaveProperty("totalAmount");
    expectTypeOf<DeliveredOrder>().not.toHaveProperty("outstandingBalance");
    expectTypeOf<DeliveredOrder>().not.toHaveProperty("paymentStatus");
    expectTypeOf<OrderDelivered["payload"]>().not.toHaveProperty("unitPrice");
    expect(JSON.stringify(delivered)).not.toMatch(
      /total|price|balance|payment|amount/i,
    );
  });

  it.each(["administrator", "waiter", "custom-runner"])(
    "authorizes %s through the centralized permission and publishes only after commit",
    async (roleCode) => {
      const { activity, gateway, published, service } = setup(
        ["delivery.delivered.mark"],
        roleCode,
      );
      await expect(
        service.markDelivered(actorId, {
          orderId,
          sourceIp: " 192.0.2.53 ",
        }),
      ).resolves.toEqual(ok(delivered));
      expect(gateway.markDelivered).toHaveBeenCalledWith({
        actorId,
        orderId,
        sourceIp: "192.0.2.53",
        occurredAt: "2026-09-01T10:05:00.000Z",
      });
      expect(activity).toEqual([
        "transaction:start",
        "rpc",
        "transaction:commit",
        "publish",
      ]);
      expect(published).toEqual([
        {
          type: "order.delivered",
          occurredAt: delivered.deliveredAt,
          payload: delivered,
        },
      ]);
    },
  );

  it("fails closed without delivery.delivered.mark", async () => {
    const { gateway, published, service } = setup([], "administrator");
    await expect(
      service.markDelivered(actorId, { orderId }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
    expect(gateway.markDelivered).not.toHaveBeenCalled();
    expect(published).toEqual([]);
  });

  it.each([
    { orderId: "not-a-uuid" },
    { orderId, sourceIp: 42 as unknown as string },
    { orderId, sourceIp: "x".repeat(65) },
  ])("rejects invalid transition input", async (input) => {
    const { gateway, service } = setup();
    await expect(service.markDelivered(actorId, input)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_DELIVERED_TRANSITION" },
    });
    expect(gateway.markDelivered).not.toHaveBeenCalled();
  });

  it("records no event when persistence rejects a skipped or duplicate transition", async () => {
    const { activity, gateway, published, service } = setup();
    vi.mocked(gateway.markDelivered).mockResolvedValueOnce(
      err({
        kind: "order-delivered-error",
        code: "ORDER_NOT_ON_THE_WAY",
      }),
    );
    await expect(
      service.markDelivered(actorId, { orderId }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ORDER_NOT_ON_THE_WAY" },
    });
    expect(activity).toEqual(["transaction:start", "transaction:rollback"]);
    expect(published).toEqual([]);
  });
});
