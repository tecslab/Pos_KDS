import { describe, expect, it, vi } from "vitest";

import {
  err,
  ok,
  type InventoryReconciled,
  type OrderUpdated,
  type Result,
} from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { TransactionBoundary } from "../transaction-boundary";
import { TransactionalOperationRunner } from "../transactional-operation-runner";
import {
  OrderModificationService,
  type ModifiedOrder,
  type ModifyOrderInput,
  type OrderModificationGateway,
} from "./order-modification";

const actorId = "10000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const lineId = "43000000-0000-4000-8000-000000000001";
const snapshotId = "44000000-0000-4000-8000-000000000001";
const productVersionId = "36000000-0000-4000-8000-000000000002";
const optionId = "37000000-0000-4000-8000-000000000001";
const inventoryItemId = "45000000-0000-4000-8000-000000000001";
const inventoryMovementId = "46000000-0000-4000-8000-000000000001";

const modified: ModifiedOrder = Object.freeze({
  orderId,
  restaurantId,
  serviceLocationId: locationId,
  orderNumber: "ORD-42",
  assignedWaiterId: actorId,
  status: "PENDING",
  totalAmount: "12.00",
  updatedAt: "2026-08-28T10:00:00.000Z",
  baskets: Object.freeze([]),
});

const inventoryMovements = Object.freeze([
  Object.freeze({
    inventoryMovementId,
    inventoryItemId,
    type: "SALE" as const,
    quantityDelta: "-2.000",
    unitOfMeasure: "unit",
    reversedMovementId: null,
  }),
]);

const input = (): ModifyOrderInput => ({
  orderId,
  expectedUpdatedAt: "2026-08-28T09:59:00.000Z",
  sourceIp: " 192.0.2.10 ",
  operations: [
    {
      kind: "add",
      basketId,
      clientCorrelationId: "new-line",
      productVersionId,
      quantity: 1,
      optionIds: [optionId],
      observations: " con   salsa ",
    },
    {
      kind: "replace",
      lineId,
      expectedCurrentSnapshotId: snapshotId,
      quantity: 2,
      optionIds: [optionId],
    },
  ],
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
  permissions: readonly string[] = ["orders.edit"],
  movements = inventoryMovements,
) {
  const activity: string[] = [];
  const gateway: OrderModificationGateway = {
    modify: vi.fn().mockImplementation(async () => {
      activity.push("rpc");
      return ok(
        Object.freeze({ order: modified, inventoryMovements: movements }),
      );
    }),
  };
  const published: (OrderUpdated | InventoryReconciled)[] = [];
  const publisher: DomainEventPublisher<OrderUpdated | InventoryReconciled> = {
    async publish(events) {
      activity.push("publish");
      published.push(...events);
    },
  };
  return {
    activity,
    gateway,
    published,
    service: new OrderModificationService(
      {
        findByAuthenticatedUserId: vi.fn().mockResolvedValue({
          userId: actorId,
          displayName: "Ana",
          isActive: true,
          roleGrants: [{ roleCode: "waiter", permissionCodes: permissions }],
        }),
      },
      gateway,
      { now: () => new Date("2026-08-28T10:00:00.000Z") },
      new TransactionalOperationRunner(new Boundary(activity), publisher),
    ),
  };
}

describe("OrderModificationService", () => {
  it("publishes the order and reconciled inventory events only after commit", async () => {
    const { activity, gateway, published, service } = setup();
    await expect(service.modify(actorId, input())).resolves.toEqual(
      ok(modified),
    );
    expect(gateway.modify).toHaveBeenCalledWith({
      actorId,
      orderId,
      expectedUpdatedAt: "2026-08-28T09:59:00.000Z",
      sourceIp: "192.0.2.10",
      occurredAt: "2026-08-28T10:00:00.000Z",
      operations: [
        {
          kind: "add",
          basketId,
          clientCorrelationId: "new-line",
          productVersionId,
          quantity: 1,
          optionIds: [optionId],
          removableIngredientIds: [],
          observations: "con salsa",
        },
        {
          kind: "replace",
          lineId,
          expectedCurrentSnapshotId: snapshotId,
          quantity: 2,
          optionIds: [optionId],
          removableIngredientIds: [],
          observations: null,
        },
      ],
    });
    expect(activity).toEqual([
      "transaction:start",
      "rpc",
      "transaction:commit",
      "publish",
    ]);
    expect(published).toEqual([
      {
        type: "order.updated",
        occurredAt: modified.updatedAt,
        payload: {
          orderId,
          restaurantId,
          serviceLocationId: locationId,
          orderNumber: "ORD-42",
          assignedWaiterId: actorId,
          status: "PENDING",
          totalAmount: "12.00",
          updatedAt: modified.updatedAt,
        },
      },
      {
        type: "inventory.reconciled",
        occurredAt: modified.updatedAt,
        payload: {
          orderId,
          restaurantId,
          movements: inventoryMovements,
        },
      },
    ]);
  });

  it("does not record an inventory event when the committed modification has no resale delta", async () => {
    const { published, service } = setup(["orders.edit"], Object.freeze([]));
    await expect(service.modify(actorId, input())).resolves.toEqual(
      ok(modified),
    );
    expect(published.map((event) => event.type)).toEqual(["order.updated"]);
  });

  it("records and publishes no events when inventory reconciliation fails", async () => {
    const { activity, gateway, published, service } = setup();
    vi.mocked(gateway.modify).mockResolvedValueOnce(
      err({
        kind: "order-modification-error",
        code: "INSUFFICIENT_INVENTORY",
      }),
    );
    await expect(service.modify(actorId, input())).resolves.toMatchObject({
      ok: false,
      error: { code: "INSUFFICIENT_INVENTORY" },
    });
    expect(activity).toEqual(["transaction:start", "transaction:rollback"]);
    expect(published).toEqual([]);
  });

  it("fails closed before persistence without orders.edit", async () => {
    const { gateway, service } = setup([]);
    await expect(service.modify(actorId, input())).resolves.toEqual({
      ok: false,
      error: { kind: "order-modification-error", code: "UNAUTHORIZED" },
    });
    expect(gateway.modify).not.toHaveBeenCalled();
  });

  it.each([
    { ...input(), operations: [] },
    { ...input(), expectedUpdatedAt: "not-an-instant" },
    {
      ...input(),
      operations: [
        { kind: "remove", lineId, expectedCurrentSnapshotId: snapshotId },
        {
          kind: "replace",
          lineId,
          expectedCurrentSnapshotId: snapshotId,
          quantity: 1,
        },
      ],
    },
    {
      ...input(),
      operations: [
        {
          kind: "add",
          basketId,
          clientCorrelationId: "x",
          productVersionId,
          quantity: 0,
        },
      ],
    },
  ] as ModifyOrderInput[])(
    "rejects malformed or conflicting operations",
    async (invalid) => {
      const { gateway, service } = setup();
      await expect(service.modify(actorId, invalid)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_MODIFICATION" },
      });
      expect(gateway.modify).not.toHaveBeenCalled();
    },
  );
});
