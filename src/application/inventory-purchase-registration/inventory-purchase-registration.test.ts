import { describe, expect, it, vi } from "vitest";

import {
  err,
  ok,
  type InventoryPurchaseRegistered,
  type Result,
} from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { TransactionBoundary } from "../transaction-boundary";
import { TransactionalOperationRunner } from "../transactional-operation-runner";
import {
  InventoryPurchaseRegistrationService,
  type InventoryPurchaseRegistrationGateway,
  type RegisteredInventoryPurchase,
} from "./inventory-purchase-registration";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const categoryId = "50000000-0000-4000-8000-000000000001";
const purchaseId = "51000000-0000-4000-8000-000000000001";
const expenseId = "52000000-0000-4000-8000-000000000001";
const itemId = "53000000-0000-4000-8000-000000000001";
const movementId = "54000000-0000-4000-8000-000000000001";

const purchase: RegisteredInventoryPurchase = Object.freeze({
  purchaseId,
  restaurantId,
  expenseCategoryId: categoryId,
  operatingExpenseId: expenseId,
  recordedById: actorId,
  supplierName: "Mercado Central",
  referenceNumber: "FAC-41",
  comments: "Weekly delivery",
  totalAmount: "12.35",
  recordedAt: "2026-09-06T10:00:00.000Z",
  lines: Object.freeze([
    Object.freeze({
      inventoryItemId: itemId,
      inventoryMovementId: movementId,
      quantity: "2.500",
      unitOfMeasure: "kg",
      unitPrice: "4.94",
      lineTotal: "12.35",
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
  permissions: readonly string[] = ["inventory.purchases.register"],
) {
  const activity: string[] = [];
  const gateway: InventoryPurchaseRegistrationGateway = {
    register: vi.fn().mockImplementation(async () => {
      activity.push("rpc");
      return ok(purchase);
    }),
  };
  const published: InventoryPurchaseRegistered[] = [];
  const publisher: DomainEventPublisher<InventoryPurchaseRegistered> = {
    async publish(events) {
      activity.push("publish");
      published.push(...events);
    },
  };
  return {
    activity,
    gateway,
    published,
    service: new InventoryPurchaseRegistrationService(
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
      { now: () => new Date("2026-09-06T10:00:00.000Z") },
      new TransactionalOperationRunner(new Boundary(activity), publisher),
    ),
  };
}

describe("InventoryPurchaseRegistrationService", () => {
  it("normalizes the purchase and publishes its inventory event only after commit", async () => {
    const { activity, gateway, published, service } = setup();
    await expect(
      service.register(actorId, {
        restaurantId,
        expenseCategoryId: categoryId,
        supplierName: " Mercado   Central ",
        referenceNumber: " FAC-41 ",
        comments: " Weekly   delivery ",
        sourceIp: " 192.0.2.58 ",
        lines: [
          { inventoryItemId: itemId, quantity: "2.5", unitPrice: "4.94" },
        ],
      }),
    ).resolves.toEqual(ok(purchase));
    expect(gateway.register).toHaveBeenCalledWith({
      actorId,
      restaurantId,
      expenseCategoryId: categoryId,
      supplierName: "Mercado Central",
      referenceNumber: "FAC-41",
      comments: "Weekly delivery",
      sourceIp: "192.0.2.58",
      occurredAt: "2026-09-06T10:00:00.000Z",
      lines: [
        { inventoryItemId: itemId, quantity: "2.500", unitPrice: "4.94" },
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
        type: "inventory.purchase.registered",
        occurredAt: purchase.recordedAt,
        payload: {
          purchaseId,
          restaurantId,
          operatingExpenseId: expenseId,
          totalAmount: "12.35",
          recordedAt: purchase.recordedAt,
          lines: purchase.lines,
        },
      },
    ]);
  });

  it("fails closed without the purchase permission", async () => {
    const { gateway, service } = setup([]);
    await expect(
      service.register(actorId, {
        restaurantId,
        expenseCategoryId: categoryId,
        lines: [{ inventoryItemId: itemId, quantity: "1", unitPrice: "1" }],
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    expect(gateway.register).not.toHaveBeenCalled();
  });

  it.each([
    { restaurantId: "bad", expenseCategoryId: categoryId, lines: [] },
    { restaurantId, expenseCategoryId: "bad", lines: [] },
    { restaurantId, expenseCategoryId: categoryId, lines: [] },
    {
      restaurantId,
      expenseCategoryId: categoryId,
      lines: [{ inventoryItemId: itemId, quantity: "0", unitPrice: "1" }],
    },
    {
      restaurantId,
      expenseCategoryId: categoryId,
      lines: [{ inventoryItemId: itemId, quantity: "1.0000", unitPrice: "1" }],
    },
    {
      restaurantId,
      expenseCategoryId: categoryId,
      lines: [
        { inventoryItemId: itemId, quantity: "1", unitPrice: "1" },
        { inventoryItemId: itemId, quantity: "2", unitPrice: "1" },
      ],
    },
  ])("rejects invalid purchase input", async (input) => {
    const { gateway, service } = setup();
    await expect(service.register(actorId, input)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_PURCHASE" },
    });
    expect(gateway.register).not.toHaveBeenCalled();
  });

  it("does not publish when the atomic RPC rolls back", async () => {
    const { activity, gateway, published, service } = setup();
    vi.mocked(gateway.register).mockResolvedValueOnce(
      err({
        kind: "inventory-purchase-registration-error",
        code: "EXPENSE_CATEGORY_UNAVAILABLE",
      }),
    );
    await service.register(actorId, {
      restaurantId,
      expenseCategoryId: categoryId,
      lines: [{ inventoryItemId: itemId, quantity: "1", unitPrice: "1" }],
    });
    expect(activity).toEqual(["transaction:start", "transaction:rollback"]);
    expect(published).toEqual([]);
  });
});
