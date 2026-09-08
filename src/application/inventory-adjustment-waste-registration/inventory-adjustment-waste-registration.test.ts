import { describe, expect, it, vi } from "vitest";

import {
  err,
  ok,
  type InventoryAdjustmentWasteRegistered,
  type Result,
} from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { TransactionBoundary } from "../transaction-boundary";
import { TransactionalOperationRunner } from "../transactional-operation-runner";
import {
  InventoryAdjustmentWasteRegistrationService,
  type InventoryAdjustmentWasteRegistrationGateway,
  type RegisteredInventoryAdjustmentWaste,
} from "./inventory-adjustment-waste-registration";

const actorId = "60000000-0000-4000-8000-000000000001";
const restaurantId = "60000000-0000-4000-8000-000000000002";
const itemId = "60000000-0000-4000-8000-000000000003";
const originId = "60000000-0000-4000-8000-000000000004";
const movementId = "60000000-0000-4000-8000-000000000005";

function registered(
  overrides: Partial<RegisteredInventoryAdjustmentWaste> = {},
): RegisteredInventoryAdjustmentWaste {
  return Object.freeze({
    originId,
    inventoryMovementId: movementId,
    restaurantId,
    inventoryItemId: itemId,
    operation: "ADJUSTMENT",
    quantityDelta: "2.500",
    unitOfMeasure: "kg",
    reason: "Count correction",
    recordedById: actorId,
    recordedAt: "2026-09-07T10:00:00.000Z",
    previousBalance: "5.000",
    newBalance: "7.500",
    ...overrides,
  });
}

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
  permissions: readonly string[] = [
    "inventory.adjustments.register",
    "inventory.waste.register",
  ],
  result: RegisteredInventoryAdjustmentWaste = registered(),
) {
  const activity: string[] = [];
  const gateway: InventoryAdjustmentWasteRegistrationGateway = {
    register: vi.fn().mockImplementation(async () => {
      activity.push("rpc");
      return ok(result);
    }),
  };
  const published: InventoryAdjustmentWasteRegistered[] = [];
  const publisher: DomainEventPublisher<InventoryAdjustmentWasteRegistered> = {
    async publish(events) {
      activity.push("publish");
      published.push(...events);
    },
  };
  return {
    activity,
    gateway,
    published,
    service: new InventoryAdjustmentWasteRegistrationService(
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
      { now: () => new Date("2026-09-07T10:00:00.000Z") },
      new TransactionalOperationRunner(new Boundary(activity), publisher),
    ),
  };
}

describe("InventoryAdjustmentWasteRegistrationService", () => {
  it("normalizes a signed adjustment and publishes only after commit", async () => {
    const { activity, gateway, published, service } = setup();
    await expect(
      service.register(actorId, {
        restaurantId,
        inventoryItemId: itemId,
        operation: "ADJUSTMENT",
        quantity: "2.5",
        reason: " Count   correction ",
        sourceIp: " 192.0.2.60 ",
      }),
    ).resolves.toEqual(ok(registered()));
    expect(gateway.register).toHaveBeenCalledWith({
      actorId,
      restaurantId,
      inventoryItemId: itemId,
      operation: "ADJUSTMENT",
      quantity: "2.500",
      reason: "Count correction",
      occurredAt: "2026-09-07T10:00:00.000Z",
      sourceIp: "192.0.2.60",
    });
    expect(activity).toEqual([
      "transaction:start",
      "rpc",
      "transaction:commit",
      "publish",
    ]);
    expect(published).toEqual([
      {
        type: "inventory.adjustment.registered",
        occurredAt: "2026-09-07T10:00:00.000Z",
        payload: {
          originId,
          inventoryMovementId: movementId,
          restaurantId,
          inventoryItemId: itemId,
          quantityDelta: "2.500",
          unitOfMeasure: "kg",
          recordedAt: "2026-09-07T10:00:00.000Z",
          previousBalance: "5.000",
          newBalance: "7.500",
        },
      },
    ]);
  });

  it("uses the distinct waste permission and stores waste as a positive input", async () => {
    const waste = registered({
      operation: "WASTE",
      quantityDelta: "-1.250",
      reason: "Spoilage",
      newBalance: "3.750",
    });
    const { gateway, published, service } = setup(
      ["inventory.waste.register"],
      waste,
    );
    await expect(
      service.register(actorId, {
        restaurantId,
        inventoryItemId: itemId,
        operation: "WASTE",
        quantity: "1.25",
        reason: " Spoilage ",
      }),
    ).resolves.toEqual(ok(waste));
    expect(gateway.register).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "WASTE",
        quantity: "1.250",
        reason: "Spoilage",
      }),
    );
    expect(published[0]?.type).toBe("inventory.waste.registered");
  });

  it.each([
    ["ADJUSTMENT", ["inventory.waste.register"]],
    ["WASTE", ["inventory.adjustments.register"]],
  ] as const)(
    "fails closed when %s permission is missing",
    async (operation, permissions) => {
      const { gateway, service } = setup(permissions);
      await expect(
        service.register(actorId, {
          restaurantId,
          inventoryItemId: itemId,
          operation,
          quantity: "1",
          reason: "Required reason",
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
      expect(gateway.register).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["ADJUSTMENT", "0", "reason"],
    ["ADJUSTMENT", "1.0000", "reason"],
    ["WASTE", "-1", "reason"],
    ["WASTE", "1", "   "],
  ] as const)(
    "rejects invalid %s input",
    async (operation, quantity, reason) => {
      const { gateway, service } = setup();
      await expect(
        service.register(actorId, {
          restaurantId,
          inventoryItemId: itemId,
          operation,
          quantity,
          reason,
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_MOVEMENT" },
      });
      expect(gateway.register).not.toHaveBeenCalled();
    },
  );

  it("does not publish when the RPC rejects the movement", async () => {
    const { activity, gateway, published, service } = setup();
    vi.mocked(gateway.register).mockResolvedValueOnce(
      err({
        kind: "inventory-adjustment-waste-registration-error",
        code: "NEGATIVE_STOCK_DISALLOWED",
      }),
    );
    await service.register(actorId, {
      restaurantId,
      inventoryItemId: itemId,
      operation: "ADJUSTMENT",
      quantity: "-9",
      reason: "Count correction",
    });
    expect(activity).toEqual(["transaction:start", "transaction:rollback"]);
    expect(published).toEqual([]);
  });
});
