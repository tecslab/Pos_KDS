import { describe, expect, it, vi } from "vitest";

import {
  err,
  ok,
  type InventoryAlertChanged,
  type InventoryAlertTransition,
  type OrderCancelled,
  type Result,
} from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { TransactionBoundary } from "../transaction-boundary";
import { TransactionalOperationRunner } from "../transactional-operation-runner";
import {
  OrderCancellationService,
  type CancelledOrder,
  type CancelOrderInput,
  type OrderCancellationGateway,
} from "./order-cancellation";

const actorId = "10000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const saleId = "46000000-0000-4000-8000-000000000001";
const rollbackId = "46000000-0000-4000-8000-000000000002";
const itemId = "45000000-0000-4000-8000-000000000001";
const alertTransition: InventoryAlertTransition = Object.freeze({
  inventoryAlertId: "61000000-0000-4000-8000-000000000001",
  inventoryMovementId: rollbackId,
  inventoryItemId: itemId,
  status: "RESOLVED",
  threshold: "5.000",
  observedBalance: "5.000",
  occurredAt: "2026-08-30T10:00:00.000Z",
});

const cancelled: CancelledOrder = Object.freeze({
  orderId,
  restaurantId,
  serviceLocationId: locationId,
  orderNumber: "ORD-42",
  assignedWaiterId: actorId,
  previousStatus: "READY",
  status: "CANCELLED",
  totalAmount: "12.00",
  reason: "Customer requested cancellation",
  cancelledById: actorId,
  cancelledAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
  inventoryMovements: Object.freeze([
    Object.freeze({
      inventoryMovementId: rollbackId,
      inventoryItemId: itemId,
      type: "ROLLBACK" as const,
      quantityDelta: "2.000",
      unitOfMeasure: "each",
      reversedMovementId: saleId,
    }),
  ]),
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
  permissions: readonly string[] = ["orders.cancel"],
  inventoryAlertTransitions: readonly InventoryAlertTransition[] = [],
) {
  const activity: string[] = [];
  const gateway: OrderCancellationGateway = {
    cancel: vi.fn().mockImplementation(async () => {
      activity.push("rpc");
      return ok(
        inventoryAlertTransitions.length === 0
          ? cancelled
          : Object.freeze({ ...cancelled, inventoryAlertTransitions }),
      );
    }),
  };
  const published: (OrderCancelled | InventoryAlertChanged)[] = [];
  const publisher: DomainEventPublisher<
    OrderCancelled | InventoryAlertChanged
  > = {
    async publish(events) {
      activity.push("publish");
      published.push(...events);
    },
  };
  return {
    activity,
    gateway,
    published,
    service: new OrderCancellationService(
      {
        findByAuthenticatedUserId: vi.fn().mockResolvedValue({
          userId: actorId,
          displayName: "Ana",
          isActive: true,
          roleGrants: [
            { roleCode: "administrator", permissionCodes: permissions },
          ],
        }),
      },
      gateway,
      { now: () => new Date("2026-08-30T10:00:00.000Z") },
      new TransactionalOperationRunner(new Boundary(activity), publisher),
    ),
  };
}

const input = (): CancelOrderInput => ({
  orderId,
  reason: "  Customer   requested cancellation  ",
  sourceIp: " 192.0.2.10 ",
});

describe("OrderCancellationService", () => {
  it("normalizes the command and publishes OrderCancelled only after commit", async () => {
    const { activity, gateway, published, service } = setup();
    await expect(service.cancel(actorId, input())).resolves.toEqual(
      ok(cancelled),
    );
    expect(gateway.cancel).toHaveBeenCalledWith({
      actorId,
      orderId,
      reason: "Customer requested cancellation",
      sourceIp: "192.0.2.10",
      occurredAt: "2026-08-30T10:00:00.000Z",
    });
    expect(activity).toEqual([
      "transaction:start",
      "rpc",
      "transaction:commit",
      "publish",
    ]);
    expect(published).toEqual([
      {
        type: "order.cancelled",
        occurredAt: cancelled.cancelledAt,
        payload: {
          orderId,
          restaurantId,
          serviceLocationId: locationId,
          orderNumber: "ORD-42",
          assignedWaiterId: actorId,
          previousStatus: "READY",
          status: "CANCELLED",
          totalAmount: "12.00",
          cancelledById: actorId,
          reason: "Customer requested cancellation",
          cancelledAt: cancelled.cancelledAt,
          updatedAt: cancelled.updatedAt,
        },
      },
    ]);
  });

  it("fails closed before persistence without orders.cancel", async () => {
    const { gateway, published, service } = setup([]);
    await expect(service.cancel(actorId, input())).resolves.toEqual({
      ok: false,
      error: { kind: "order-cancellation-error", code: "UNAUTHORIZED" },
    });
    expect(gateway.cancel).not.toHaveBeenCalled();
    expect(published).toEqual([]);
  });

  it.each([
    { ...input(), orderId: "not-a-uuid" },
    { ...input(), reason: "   " },
    { ...input(), reason: "x".repeat(2_001) },
    { ...input(), sourceIp: "x".repeat(65) },
  ])("rejects invalid cancellation input", async (invalid) => {
    const { gateway, service } = setup();
    await expect(service.cancel(actorId, invalid)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_CANCELLATION" },
    });
    expect(gateway.cancel).not.toHaveBeenCalled();
  });

  it("records no event when the transactional cancellation is rejected", async () => {
    const { activity, gateway, published, service } = setup();
    vi.mocked(gateway.cancel).mockResolvedValueOnce(
      err({
        kind: "order-cancellation-error",
        code: "ORDER_NOT_CANCELLABLE",
      }),
    );
    await expect(service.cancel(actorId, input())).resolves.toMatchObject({
      ok: false,
      error: { code: "ORDER_NOT_CANCELLABLE" },
    });
    expect(activity).toEqual(["transaction:start", "transaction:rollback"]);
    expect(published).toEqual([]);
  });

  it("fails before persistence when the audit clock is invalid", async () => {
    const { gateway, service } = setup();
    Object.defineProperty(service, "clock", {
      value: { now: () => new Date(Number.NaN) },
    });
    await expect(service.cancel(actorId, input())).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
    expect(gateway.cancel).not.toHaveBeenCalled();
  });

  it("records exactly one resolved alert event only after commit", async () => {
    const { activity, published, service } = setup(
      ["orders.cancel"],
      [alertTransition],
    );

    await expect(service.cancel(actorId, input())).resolves.toEqual(
      ok(cancelled),
    );

    expect(activity).toEqual([
      "transaction:start",
      "rpc",
      "transaction:commit",
      "publish",
    ]);
    expect(published.map((event) => event.type)).toEqual([
      "order.cancelled",
      "inventory.alert.changed",
    ]);
    expect(published[1]).toMatchObject({
      type: "inventory.alert.changed",
      occurredAt: alertTransition.occurredAt,
      payload: {
        restaurantId,
        inventoryAlertId: alertTransition.inventoryAlertId,
        inventoryMovementId: rollbackId,
        inventoryItemId: itemId,
        status: "RESOLVED",
      },
    });
  });
});
