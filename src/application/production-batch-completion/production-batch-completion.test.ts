import { describe, expect, it, vi } from "vitest";

import {
  err,
  ok,
  type InventoryAlertChanged,
  type InventoryAlertTransition,
  type ProductionCompleted,
  type Result,
} from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { TransactionBoundary } from "../transaction-boundary";
import { TransactionalOperationRunner } from "../transactional-operation-runner";
import {
  ProductionBatchCompletionService,
  type CompletedProductionBatch,
  type ProductionBatchCompletionGateway,
} from "./production-batch-completion";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "20000000-0000-4000-8000-000000000001";
const recipeId = "30000000-0000-4000-8000-000000000001";
const recipeVersionId = "40000000-0000-4000-8000-000000000001";
const productId = "50000000-0000-4000-8000-000000000001";
const batchId = "60000000-0000-4000-8000-000000000001";
const ingredientItemId = "70000000-0000-4000-8000-000000000001";
const ingredientMovementId = "71000000-0000-4000-8000-000000000001";
const outputItemId = "80000000-0000-4000-8000-000000000001";
const outputMovementId = "81000000-0000-4000-8000-000000000001";
const completedAt = "2026-09-08T10:00:00.000Z";

const batch: CompletedProductionBatch = Object.freeze({
  batchId,
  restaurantId,
  recipeId,
  recipeVersionId,
  recipeVersionNumber: 3,
  productId,
  status: "COMPLETED",
  producedQuantity: "5.000",
  unitOfMeasure: "unit",
  completedById: actorId,
  completedAt,
  notes: "Morning prep",
  ingredients: Object.freeze([
    Object.freeze({
      inventoryItemId: ingredientItemId,
      inventoryMovementId: ingredientMovementId,
      quantityConsumed: "2.500",
      unitOfMeasure: "kg",
      previousBalance: "10.000",
      newBalance: "7.500",
    }),
  ]),
  output: Object.freeze({
    inventoryItemId: outputItemId,
    inventoryMovementId: outputMovementId,
    quantityProduced: "5.000",
    unitOfMeasure: "unit",
    previousBalance: "1.000",
    newBalance: "6.000",
  }),
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
  permissions: readonly string[] = ["production.batch.create"],
  transitions: readonly InventoryAlertTransition[] = [],
) {
  const activity: string[] = [];
  const gateway: ProductionBatchCompletionGateway = {
    complete: vi.fn().mockImplementation(async () => {
      activity.push("rpc");
      return ok(
        transitions.length === 0
          ? batch
          : Object.freeze({ ...batch, inventoryAlertTransitions: transitions }),
      );
    }),
  };
  const published: (ProductionCompleted | InventoryAlertChanged)[] = [];
  const publisher: DomainEventPublisher<
    ProductionCompleted | InventoryAlertChanged
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
    service: new ProductionBatchCompletionService(
      {
        findByAuthenticatedUserId: vi.fn().mockResolvedValue({
          userId: actorId,
          displayName: "Ana",
          isActive: true,
          roleGrants: [{ roleCode: "custom", permissionCodes: permissions }],
        }),
      },
      gateway,
      { now: () => new Date(completedAt) },
      new TransactionalOperationRunner(new Boundary(activity), publisher),
    ),
  };
}

describe("ProductionBatchCompletionService", () => {
  it("normalizes input and publishes completion only after the RPC commits", async () => {
    const { activity, gateway, published, service } = setup();

    await expect(
      service.complete(actorId, {
        restaurantId,
        recipeVersionId,
        producedQuantity: "5",
        notes: " Morning   prep ",
        sourceIp: " 192.0.2.64 ",
      }),
    ).resolves.toEqual(ok(batch));

    expect(gateway.complete).toHaveBeenCalledWith({
      actorId,
      restaurantId,
      recipeVersionId,
      producedQuantity: "5.000",
      notes: "Morning prep",
      occurredAt: completedAt,
      sourceIp: "192.0.2.64",
    });
    expect(activity).toEqual([
      "transaction:start",
      "rpc",
      "transaction:commit",
      "publish",
    ]);
    expect(published).toEqual([
      {
        type: "production.completed",
        occurredAt: completedAt,
        payload: {
          batchId,
          restaurantId,
          recipeVersionId,
          producedQuantity: "5.000",
          unitOfMeasure: "unit",
          completedAt,
          ingredients: batch.ingredients,
          output: batch.output,
        },
      },
    ]);
  });

  it("fails closed for a custom role without the production permission", async () => {
    const { gateway, service } = setup([]);
    await expect(
      service.complete(actorId, {
        restaurantId,
        recipeVersionId,
        producedQuantity: "1",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    expect(gateway.complete).not.toHaveBeenCalled();
  });

  it.each([
    { restaurantId: "bad", recipeVersionId, producedQuantity: "1" },
    { restaurantId, recipeVersionId: "bad", producedQuantity: "1" },
    { restaurantId, recipeVersionId, producedQuantity: "0" },
    { restaurantId, recipeVersionId, producedQuantity: "1.0000" },
    { restaurantId, recipeVersionId, producedQuantity: "-1" },
    {
      restaurantId,
      recipeVersionId,
      producedQuantity: "1",
      notes: "x".repeat(2001),
    },
  ])("rejects an invalid batch", async (input) => {
    const { gateway, service } = setup();
    await expect(service.complete(actorId, input)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_BATCH" },
    });
    expect(gateway.complete).not.toHaveBeenCalled();
  });

  it("does not publish when the atomic RPC rejects insufficient stock", async () => {
    const { activity, gateway, published, service } = setup();
    vi.mocked(gateway.complete).mockResolvedValueOnce(
      err({
        kind: "production-batch-completion-error",
        code: "INSUFFICIENT_INVENTORY",
      }),
    );
    await service.complete(actorId, {
      restaurantId,
      recipeVersionId,
      producedQuantity: "5",
    });
    expect(activity).toEqual(["transaction:start", "transaction:rollback"]);
    expect(published).toEqual([]);
  });

  it("records low-stock transitions after the production event", async () => {
    const transition: InventoryAlertTransition = Object.freeze({
      inventoryAlertId: "90000000-0000-4000-8000-000000000001",
      inventoryMovementId: ingredientMovementId,
      inventoryItemId: ingredientItemId,
      status: "ACTIVE",
      threshold: "8.000",
      observedBalance: "7.500",
      occurredAt: completedAt,
    });
    const { published, service } = setup(
      ["production.batch.create"],
      [transition],
    );
    await service.complete(actorId, {
      restaurantId,
      recipeVersionId,
      producedQuantity: "5",
    });
    expect(published.map((event) => event.type)).toEqual([
      "production.completed",
      "inventory.alert.changed",
    ]);
    expect(published[1]).toMatchObject({
      payload: { restaurantId, inventoryItemId: ingredientItemId },
    });
  });
});
