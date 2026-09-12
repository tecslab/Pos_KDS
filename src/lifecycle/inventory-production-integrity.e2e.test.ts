import { describe, expect, it } from "vitest";

import {
  InventoryAdjustmentWasteRegistrationService,
  InventoryPurchaseRegistrationService,
  OrderCancellationService,
  OrderConfirmationService,
  ProductionBatchCompletionService,
  TransactionalOperationRunner,
  type AuthorizationProfile,
  type AuthorizationProfileReader,
  type CancelledOrder,
  type CompleteProductionBatchCommand,
  type CompletedProductionBatch,
  type DomainEventPublisher,
  type InventoryAdjustmentWasteRegistrationError,
  type InventoryAdjustmentWasteRegistrationGateway,
  type InventoryPurchaseRegistrationError,
  type InventoryPurchaseRegistrationGateway,
  type OrderCancellationCommand,
  type OrderCancellationError,
  type OrderCancellationGateway,
  type OrderConfirmationCommand,
  type OrderConfirmationError,
  type OrderConfirmationGateway,
  type ProductionBatchCompletionError,
  type ProductionBatchCompletionGateway,
  type RegisterInventoryAdjustmentWasteCommand,
  type RegisterInventoryPurchaseCommand,
  type RegisteredInventoryAdjustmentWaste,
  type RegisteredInventoryPurchase,
  type TransactionBoundary,
} from "../application";
import {
  err,
  ok,
  type InventoryAdjustmentWasteRegistered,
  type InventoryAlertChanged,
  type InventoryPurchaseRegistered,
  type OrderCancelled,
  type OrderConfirmed,
  type ProductionCompleted,
  type Result,
} from "../domain";

const adminId = "10000000-0000-4000-8000-000000000001";
const waiterId = "10000000-0000-4000-8000-000000000002";
const customInventoryOperatorId = "10000000-0000-4000-8000-000000000003";
const nominalAdministratorId = "10000000-0000-4000-8000-000000000004";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const rawItemId = "32000000-0000-4000-8000-000000000001";
const resaleItemId = "32000000-0000-4000-8000-000000000002";
const outputItemId = "32000000-0000-4000-8000-000000000003";
const expenseCategoryId = "33000000-0000-4000-8000-000000000001";
const resaleProductVersionId = "34000000-0000-4000-8000-000000000001";
const recipeId = "35000000-0000-4000-8000-000000000001";
const recipeVersionId = "36000000-0000-4000-8000-000000000001";
const newerRecipeVersionId = "36000000-0000-4000-8000-000000000002";

type WorkflowEvent =
  | InventoryPurchaseRegistered
  | InventoryAdjustmentWasteRegistered
  | ProductionCompleted
  | OrderConfirmed
  | OrderCancelled
  | InventoryAlertChanged;

type MovementType =
  | "PURCHASE"
  | "ADJUSTMENT"
  | "WASTE"
  | "SALE"
  | "ROLLBACK"
  | "PRODUCTION_CONSUMPTION"
  | "PRODUCTION_OUTPUT";

type StoredMovement = Readonly<{
  id: string;
  inventoryItemId: string;
  type: MovementType;
  quantityDelta: bigint;
  unitOfMeasure: "each";
  originType:
    "PURCHASE" | "ADJUSTMENT" | "WASTE" | "SALE" | "ROLLBACK" | "PRODUCTION";
  originId: string;
  reversedMovementId: string | null;
  comments: string | null;
  actorId: string;
  occurredAt: string;
}>;

type StoredAudit = Readonly<{
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  occurredAt: string;
}>;

type StoredOrder = {
  id: string;
  actorId: string;
  saleMovementIds: readonly string[];
  status: "PENDING" | "CANCELLED";
  history: Array<
    Readonly<{ status: "PENDING" | "CANCELLED"; reason: string | null }>
  >;
};

class RecordingBoundary implements TransactionBoundary {
  commits = 0;

  async run<T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    const result = await work();
    if (result.ok) this.commits += 1;
    return result;
  }
}

class RecordingPublisher implements DomainEventPublisher<WorkflowEvent> {
  readonly events: WorkflowEvent[] = [];

  async publish(events: readonly WorkflowEvent[]): Promise<void> {
    this.events.push(...events);
  }
}

class InventoryProductionStore
  implements
    InventoryPurchaseRegistrationGateway,
    InventoryAdjustmentWasteRegistrationGateway,
    ProductionBatchCompletionGateway,
    OrderConfirmationGateway,
    OrderCancellationGateway
{
  currentRecipeVersionId = recipeVersionId;
  readonly recipeVersions = new Map<
    string,
    Readonly<{
      id: string;
      versionNumber: number;
      rawUnitsPerOutput: bigint;
    }>
  >([
    [
      recipeVersionId,
      Object.freeze({
        id: recipeVersionId,
        versionNumber: 3,
        rawUnitsPerOutput: BigInt(2),
      }),
    ],
    [
      newerRecipeVersionId,
      Object.freeze({
        id: newerRecipeVersionId,
        versionNumber: 4,
        rawUnitsPerOutput: BigInt(3),
      }),
    ],
  ]);
  readonly balances = new Map<string, bigint>([
    [rawItemId, BigInt(0)],
    [resaleItemId, BigInt(0)],
    [outputItemId, BigInt(0)],
  ]);
  readonly movements: StoredMovement[] = [];
  readonly audits: StoredAudit[] = [];
  readonly expenses: Array<Readonly<{ purchaseId: string; amount: string }>> =
    [];
  readonly orders: StoredOrder[] = [];
  readonly batches: CompletedProductionBatch[] = [];

  constructor(readonly allowNegativeStock = false) {}

  async register(
    command: RegisterInventoryPurchaseCommand,
  ): Promise<
    Result<RegisteredInventoryPurchase, InventoryPurchaseRegistrationError>
  >;
  async register(
    command: RegisterInventoryAdjustmentWasteCommand,
  ): Promise<
    Result<
      RegisteredInventoryAdjustmentWaste,
      InventoryAdjustmentWasteRegistrationError
    >
  >;
  async register(
    command:
      | RegisterInventoryPurchaseCommand
      | RegisterInventoryAdjustmentWasteCommand,
  ): Promise<
    Result<
      RegisteredInventoryPurchase | RegisteredInventoryAdjustmentWaste,
      | InventoryPurchaseRegistrationError
      | InventoryAdjustmentWasteRegistrationError
    >
  > {
    return "lines" in command
      ? this.registerPurchase(command)
      : this.registerAdjustmentOrWaste(command);
  }

  async complete(
    command: CompleteProductionBatchCommand,
  ): Promise<Result<CompletedProductionBatch, ProductionBatchCompletionError>> {
    const recipeVersion = this.recipeVersions.get(command.recipeVersionId);
    if (recipeVersion === undefined) {
      return err(productionError("RECIPE_VERSION_UNAVAILABLE"));
    }
    const multiplier = quantity(command.producedQuantity);
    const requiredRaw = multiplier * recipeVersion.rawUnitsPerOutput;
    const currentRaw = this.balance(rawItemId);
    if (currentRaw < requiredRaw) {
      return err(productionError("INSUFFICIENT_INVENTORY"));
    }

    const batchId = this.id("51000000-0000-4000-8000", this.batches.length + 1);
    const consumption = this.appendMovement({
      inventoryItemId: rawItemId,
      type: "PRODUCTION_CONSUMPTION",
      quantityDelta: -requiredRaw,
      originType: "PRODUCTION",
      originId: batchId,
      comments: command.notes,
      actorId: command.actorId,
      occurredAt: command.occurredAt,
    });
    const previousOutput = this.balance(outputItemId);
    const output = this.appendMovement({
      inventoryItemId: outputItemId,
      type: "PRODUCTION_OUTPUT",
      quantityDelta: multiplier,
      originType: "PRODUCTION",
      originId: batchId,
      comments: command.notes,
      actorId: command.actorId,
      occurredAt: command.occurredAt,
    });
    const batch: CompletedProductionBatch = Object.freeze({
      batchId,
      restaurantId,
      recipeId,
      recipeVersionId: command.recipeVersionId,
      recipeVersionNumber: recipeVersion.versionNumber,
      productId: "37000000-0000-4000-8000-000000000001",
      status: "COMPLETED",
      producedQuantity: command.producedQuantity,
      unitOfMeasure: "each",
      completedById: command.actorId,
      completedAt: command.occurredAt,
      notes: command.notes,
      ingredients: Object.freeze([
        Object.freeze({
          inventoryItemId: rawItemId,
          inventoryMovementId: consumption.id,
          quantityConsumed: decimal(requiredRaw),
          unitOfMeasure: "each",
          previousBalance: decimal(currentRaw),
          newBalance: decimal(currentRaw - requiredRaw),
        }),
      ]),
      output: Object.freeze({
        inventoryItemId: outputItemId,
        inventoryMovementId: output.id,
        quantityProduced: command.producedQuantity,
        unitOfMeasure: "each",
        previousBalance: decimal(previousOutput),
        newBalance: decimal(previousOutput + multiplier),
      }),
    });
    this.batches.push(batch);
    this.audit(
      "production_batch.completed",
      batchId,
      command.actorId,
      command.occurredAt,
      "production_batch",
    );
    return ok(batch);
  }

  async confirm(
    command: OrderConfirmationCommand,
  ): Promise<
    Result<ReturnType<typeof confirmedOrder>, OrderConfirmationError>
  > {
    const units = command.baskets
      .flatMap((basket) => basket.lines)
      .reduce(
        (sum, line) =>
          line.productVersionId === resaleProductVersionId
            ? sum + BigInt(line.quantity) * BigInt(1_000)
            : sum,
        BigInt(0),
      );
    if (!this.allowNegativeStock && this.balance(resaleItemId) < units) {
      return err(orderConfirmationError("INSUFFICIENT_INVENTORY"));
    }

    const orderId = this.id("41000000-0000-4000-8000", this.orders.length + 1);
    const sale = this.appendMovement({
      inventoryItemId: resaleItemId,
      type: "SALE",
      quantityDelta: -units,
      originType: "SALE",
      originId: orderId,
      comments: null,
      actorId: command.actorId,
      occurredAt: command.occurredAt,
    });
    this.audit(
      "inventory_movement.sale_recorded",
      sale.id,
      command.actorId,
      command.occurredAt,
      "inventory_movement",
    );
    this.orders.push({
      id: orderId,
      actorId: command.actorId,
      saleMovementIds: Object.freeze([sale.id]),
      status: "PENDING",
      history: [{ status: "PENDING", reason: null }],
    });
    this.audit(
      "order.confirmed",
      orderId,
      command.actorId,
      command.occurredAt,
      "order",
    );
    return ok(confirmedOrder(orderId, command));
  }

  async cancel(
    command: OrderCancellationCommand,
  ): Promise<Result<CancelledOrder, OrderCancellationError>> {
    const order = this.orders.find(
      (candidate) => candidate.id === command.orderId,
    );
    if (order === undefined) return err(cancellationError("NOT_FOUND"));
    if (order.status !== "PENDING") {
      return err(cancellationError("ORDER_NOT_CANCELLABLE"));
    }
    const rollbackMovements = order.saleMovementIds.map((saleMovementId) => {
      const sale = this.movements.find(
        (movement) => movement.id === saleMovementId,
      )!;
      const rollback = this.appendMovement({
        inventoryItemId: sale.inventoryItemId,
        type: "ROLLBACK",
        quantityDelta: -sale.quantityDelta,
        originType: "ROLLBACK",
        originId: order.id,
        reversedMovementId: sale.id,
        comments: "Order cancellation",
        actorId: command.actorId,
        occurredAt: command.occurredAt,
      });
      this.audit(
        "inventory_movement.rollback_recorded",
        rollback.id,
        command.actorId,
        command.occurredAt,
        "inventory_movement",
      );
      return rollback;
    });
    order.status = "CANCELLED";
    order.history.push({ status: "CANCELLED", reason: command.reason });
    this.audit(
      "order.cancelled",
      order.id,
      command.actorId,
      command.occurredAt,
      "order",
    );
    return ok({
      orderId: order.id,
      restaurantId,
      serviceLocationId: locationId,
      orderNumber: "ORD-1",
      assignedWaiterId: order.actorId,
      previousStatus: "PENDING",
      status: "CANCELLED",
      totalAmount: "10.00",
      reason: command.reason,
      cancelledById: command.actorId,
      cancelledAt: command.occurredAt,
      updatedAt: command.occurredAt,
      inventoryMovements: rollbackMovements.map((movement) => ({
        inventoryMovementId: movement.id,
        inventoryItemId: movement.inventoryItemId,
        type: "ROLLBACK",
        quantityDelta: decimal(movement.quantityDelta),
        unitOfMeasure: movement.unitOfMeasure,
        reversedMovementId: movement.reversedMovementId,
      })),
    });
  }

  balance(itemId: string): bigint {
    return this.balances.get(itemId) ?? BigInt(0);
  }

  private registerPurchase(
    command: RegisterInventoryPurchaseCommand,
  ): Result<RegisteredInventoryPurchase, InventoryPurchaseRegistrationError> {
    const purchaseId = this.id(
      "61000000-0000-4000-8000",
      this.expenses.length + 1,
    );
    let totalCents = BigInt(0);
    const lines = command.lines.map((line) => {
      const quantityValue = quantity(line.quantity);
      const unitPriceCents = moneyCents(line.unitPrice);
      const movement = this.appendMovement({
        inventoryItemId: line.inventoryItemId,
        type: "PURCHASE",
        quantityDelta: quantityValue,
        originType: "PURCHASE",
        originId: purchaseId,
        comments: command.comments,
        actorId: command.actorId,
        occurredAt: command.occurredAt,
      });
      const lineTotalCents = (quantityValue * unitPriceCents) / BigInt(1_000);
      totalCents += lineTotalCents;
      return Object.freeze({
        inventoryItemId: line.inventoryItemId,
        inventoryMovementId: movement.id,
        quantity: line.quantity,
        unitOfMeasure: "each",
        unitPrice: line.unitPrice,
        lineTotal: money(lineTotalCents),
      });
    });
    const operatingExpenseId = this.id(
      "62000000-0000-4000-8000",
      this.expenses.length + 1,
    );
    this.expenses.push(
      Object.freeze({ purchaseId, amount: money(totalCents) }),
    );
    this.audit(
      "inventory_purchase.registered",
      purchaseId,
      command.actorId,
      command.occurredAt,
      "inventory_purchase",
    );
    return ok({
      purchaseId,
      restaurantId,
      expenseCategoryId: command.expenseCategoryId,
      operatingExpenseId,
      recordedById: command.actorId,
      supplierName: command.supplierName,
      referenceNumber: command.referenceNumber,
      comments: command.comments,
      totalAmount: money(totalCents),
      recordedAt: command.occurredAt,
      lines,
    });
  }

  private registerAdjustmentOrWaste(
    command: RegisterInventoryAdjustmentWasteCommand,
  ): Result<
    RegisteredInventoryAdjustmentWaste,
    InventoryAdjustmentWasteRegistrationError
  > {
    const magnitude = quantity(command.quantity.replace("-", ""));
    const delta =
      command.operation === "WASTE"
        ? -magnitude
        : command.quantity.startsWith("-")
          ? -magnitude
          : magnitude;
    const previous = this.balance(command.inventoryItemId);
    if (!this.allowNegativeStock && previous + delta < BigInt(0)) {
      return err(adjustmentError("NEGATIVE_STOCK_DISALLOWED"));
    }
    const originId = this.id(
      "63000000-0000-4000-8000",
      this.movements.length + 1,
    );
    const movement = this.appendMovement({
      inventoryItemId: command.inventoryItemId,
      type: command.operation,
      quantityDelta: delta,
      originType: command.operation,
      originId,
      comments: command.reason,
      actorId: command.actorId,
      occurredAt: command.occurredAt,
    });
    this.audit(
      command.operation === "WASTE"
        ? "inventory_waste.registered"
        : "inventory_adjustment.registered",
      originId,
      command.actorId,
      command.occurredAt,
      command.operation === "WASTE"
        ? "inventory_waste_record"
        : "inventory_adjustment",
    );
    return ok({
      originId,
      inventoryMovementId: movement.id,
      restaurantId,
      inventoryItemId: command.inventoryItemId,
      operation: command.operation,
      quantityDelta: decimal(delta),
      unitOfMeasure: "each",
      reason: command.reason,
      recordedById: command.actorId,
      recordedAt: command.occurredAt,
      previousBalance: decimal(previous),
      newBalance: decimal(previous + delta),
    });
  }

  private appendMovement(
    input: Omit<StoredMovement, "id" | "unitOfMeasure" | "reversedMovementId"> &
      Readonly<{ reversedMovementId?: string | null }>,
  ): StoredMovement {
    const movement = Object.freeze({
      ...input,
      id: this.id("64000000-0000-4000-8000", this.movements.length + 1),
      unitOfMeasure: "each" as const,
      reversedMovementId: input.reversedMovementId ?? null,
    });
    this.movements.push(movement);
    this.balances.set(
      movement.inventoryItemId,
      this.balance(movement.inventoryItemId) + movement.quantityDelta,
    );
    return movement;
  }

  private audit(
    action: string,
    entityId: string,
    actorId: string,
    occurredAt: string,
    entityType: string,
  ) {
    this.audits.push(
      Object.freeze({ action, entityType, entityId, actorId, occurredAt }),
    );
  }

  private id(prefix: string, sequence: number): string {
    return `${prefix}-${String(sequence).padStart(12, "0")}`;
  }
}

function authorizationProfiles(): AuthorizationProfileReader {
  const profiles = new Map<string, AuthorizationProfile>([
    [
      adminId,
      profile(adminId, "administrator", [
        "inventory.purchases.register",
        "inventory.adjustments.register",
        "inventory.waste.register",
        "production.batch.create",
        "orders.cancel",
      ]),
    ],
    [waiterId, profile(waiterId, "waiter", ["orders.create"])],
    [
      customInventoryOperatorId,
      profile(customInventoryOperatorId, "stock_control", [
        "inventory.purchases.register",
        "inventory.adjustments.register",
        "inventory.waste.register",
        "production.batch.create",
      ]),
    ],
    [
      nominalAdministratorId,
      profile(nominalAdministratorId, "administrator", []),
    ],
  ]);
  return {
    findByAuthenticatedUserId: async (userId) => profiles.get(userId) ?? null,
  };
}

function profile(
  userId: string,
  roleCode: string,
  permissionCodes: readonly string[],
): AuthorizationProfile {
  return {
    userId,
    displayName: roleCode,
    isActive: true,
    roleGrants: [{ roleCode, permissionCodes }],
  };
}

function services(store: InventoryProductionStore) {
  const boundary = new RecordingBoundary();
  const publisher = new RecordingPublisher();
  const operationRunner = () =>
    new TransactionalOperationRunner<WorkflowEvent>(boundary, publisher);
  const profiles = authorizationProfiles();
  return {
    boundary,
    publisher,
    purchase: new InventoryPurchaseRegistrationService(
      profiles,
      store,
      fixedClock("2026-09-11T13:00:00.000Z"),
      operationRunner(),
    ),
    movement: new InventoryAdjustmentWasteRegistrationService(
      profiles,
      store,
      fixedClock("2026-09-11T13:05:00.000Z"),
      operationRunner(),
    ),
    confirmation: new OrderConfirmationService(
      profiles,
      store,
      fixedClock("2026-09-11T13:10:00.000Z"),
      operationRunner(),
    ),
    cancellation: new OrderCancellationService(
      profiles,
      store,
      fixedClock("2026-09-11T13:15:00.000Z"),
      operationRunner(),
    ),
    production: new ProductionBatchCompletionService(
      profiles,
      store,
      fixedClock("2026-09-11T13:20:00.000Z"),
      operationRunner(),
    ),
  };
}

function fixedClock(instant: string) {
  return { now: () => new Date(instant) };
}

function quantity(value: string): bigint {
  const [integer, fraction = ""] = value.split(".");
  return (
    BigInt(integer) * BigInt(1_000) + BigInt((fraction + "000").slice(0, 3))
  );
}

function decimal(value: bigint): string {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const canonical = absolute.toString().padStart(4, "0");
  return `${negative ? "-" : ""}${canonical.slice(0, -3)}.${canonical.slice(-3)}`;
}

function moneyCents(value: string): bigint {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
}

function money(cents: bigint): string {
  const canonical = cents.toString().padStart(3, "0");
  return `${canonical.slice(0, -2)}.${canonical.slice(-2)}`;
}

function confirmedOrder(orderId: string, command: OrderConfirmationCommand) {
  return {
    orderId,
    restaurantId,
    serviceLocationId: command.serviceLocationId,
    orderNumber: "ORD-1",
    assignedWaiterId: command.actorId,
    status: "PENDING" as const,
    notes: command.notes,
    totalAmount: "10.00",
    confirmedAt: command.occurredAt,
    baskets: command.baskets.map((basket) => ({
      id: "42000000-0000-4000-8000-000000000001",
      status: "PENDING" as const,
      totalAmount: "10.00",
      lines: basket.lines.map((line) => ({
        id: "43000000-0000-4000-8000-000000000001",
        productVersionId: line.productVersionId,
        productName: "Bebida",
        quantity: line.quantity,
        baseUnitPrice: "5.00",
        finalUnitPrice: "5.00",
        lineTotal: "10.00",
        taxCode: "IVA",
        taxName: "IVA",
        taxRate: "0.150000",
        priceIncludesTax: true,
        selectedOptions: [],
        removedIngredients: [],
        observations: line.observations,
      })),
    })),
  };
}

function purchaseError(
  code: InventoryPurchaseRegistrationError["code"],
): InventoryPurchaseRegistrationError {
  return { kind: "inventory-purchase-registration-error", code };
}

function adjustmentError(
  code: InventoryAdjustmentWasteRegistrationError["code"],
): InventoryAdjustmentWasteRegistrationError {
  return { kind: "inventory-adjustment-waste-registration-error", code };
}

function productionError(
  code: ProductionBatchCompletionError["code"],
): ProductionBatchCompletionError {
  return { kind: "production-batch-completion-error", code };
}

function orderConfirmationError(
  code: OrderConfirmationError["code"],
): OrderConfirmationError {
  return { kind: "order-confirmation-error", code };
}

function cancellationError(
  code: OrderCancellationError["code"],
): OrderCancellationError {
  return { kind: "order-cancellation-error", code };
}

function purchaseInput() {
  return {
    restaurantId,
    expenseCategoryId,
    supplierName: "Mercado Central",
    referenceNumber: "FAC-100",
    comments: "Compra semanal",
    lines: [
      { inventoryItemId: rawItemId, quantity: "10", unitPrice: "2" },
      { inventoryItemId: resaleItemId, quantity: "5", unitPrice: "3" },
    ],
  };
}

function resaleOrderInput(quantityToSell = 2) {
  return {
    serviceLocationId: locationId,
    baskets: [
      {
        clientCorrelationId: "basket-1",
        lines: [
          {
            clientCorrelationId: "line-1",
            productVersionId: resaleProductVersionId,
            quantity: quantityToSell,
          },
        ],
      },
    ],
  };
}

describe("inventory and production integrity end-to-end", () => {
  it("preserves immutable origins and history across purchase, corrections, resale rollback, and production", async () => {
    const store = new InventoryProductionStore();
    const workflow = services(store);

    const purchase = await workflow.purchase.register(adminId, purchaseInput());
    expect(purchase).toMatchObject({
      ok: true,
      value: { totalAmount: "35.00", recordedById: adminId },
    });
    expect(store.expenses).toEqual([
      {
        purchaseId: purchase.ok ? purchase.value.purchaseId : "",
        amount: "35.00",
      },
    ]);

    await expect(
      workflow.movement.register(adminId, {
        restaurantId,
        inventoryItemId: rawItemId,
        operation: "ADJUSTMENT",
        quantity: "1",
        reason: "Conteo de apertura",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { quantityDelta: "1.000", reason: "Conteo de apertura" },
    });
    await expect(
      workflow.movement.register(adminId, {
        restaurantId,
        inventoryItemId: resaleItemId,
        operation: "WASTE",
        quantity: "1",
        reason: "Envase roto",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { quantityDelta: "-1.000", reason: "Envase roto" },
    });

    const confirmation = await workflow.confirmation.confirm(
      waiterId,
      resaleOrderInput(),
    );
    expect(confirmation).toMatchObject({
      ok: true,
      value: { status: "PENDING" },
    });
    expect(store.balance(resaleItemId)).toBe(BigInt(2_000));
    const saleMovement = store.movements.find(
      (movement) => movement.type === "SALE",
    )!;
    const saleSnapshot = structuredClone(saleMovement);
    expect(saleMovement).toMatchObject({
      inventoryItemId: resaleItemId,
      type: "SALE",
      quantityDelta: BigInt(-2_000),
      originType: "SALE",
      originId: confirmation.ok ? confirmation.value.orderId : "",
      reversedMovementId: null,
      comments: null,
      actorId: waiterId,
      occurredAt: "2026-09-11T13:10:00.000Z",
    });

    const cancellation = await workflow.cancellation.cancel(adminId, {
      orderId: confirmation.ok ? confirmation.value.orderId : "",
      reason: "Cliente canceló antes de preparación",
    });
    expect(cancellation).toMatchObject({
      ok: true,
      value: {
        status: "CANCELLED",
        inventoryMovements: [
          { type: "ROLLBACK", reversedMovementId: saleMovement.id },
        ],
      },
    });
    expect(store.balance(resaleItemId)).toBe(BigInt(4_000));
    const rollbackMovement = store.movements.find(
      (movement) => movement.type === "ROLLBACK",
    )!;
    expect(rollbackMovement).toMatchObject({
      inventoryItemId: resaleItemId,
      type: "ROLLBACK",
      quantityDelta: BigInt(2_000),
      originType: "ROLLBACK",
      originId: confirmation.ok ? confirmation.value.orderId : "",
      reversedMovementId: saleMovement.id,
      comments: "Order cancellation",
      actorId: adminId,
      occurredAt: "2026-09-11T13:15:00.000Z",
    });
    expect(
      store.audits.filter((entry) => entry.entityType === "inventory_movement"),
    ).toEqual([
      {
        action: "inventory_movement.sale_recorded",
        entityType: "inventory_movement",
        entityId: saleMovement.id,
        actorId: waiterId,
        occurredAt: "2026-09-11T13:10:00.000Z",
      },
      {
        action: "inventory_movement.rollback_recorded",
        entityType: "inventory_movement",
        entityId: rollbackMovement.id,
        actorId: adminId,
        occurredAt: "2026-09-11T13:15:00.000Z",
      },
    ]);
    expect(store.movements).toContain(saleMovement);
    expect(saleMovement).toEqual(saleSnapshot);
    expect(Object.isFrozen(saleMovement)).toBe(true);
    expect(store.orders[0]?.history).toEqual([
      { status: "PENDING", reason: null },
      { status: "CANCELLED", reason: "Cliente canceló antes de preparación" },
    ]);

    const production = await workflow.production.complete(adminId, {
      restaurantId,
      recipeVersionId,
      producedQuantity: "2",
      notes: "Lote de almuerzo",
    });
    expect(production).toMatchObject({
      ok: true,
      value: {
        recipeVersionId,
        recipeVersionNumber: 3,
        producedQuantity: "2.000",
        completedById: adminId,
        ingredients: [{ quantityConsumed: "4.000" }],
        output: { quantityProduced: "2.000" },
      },
    });
    const originalBatch = production.ok ? production.value : null;
    const originalBatchSnapshot = structuredClone(originalBatch);
    store.currentRecipeVersionId = newerRecipeVersionId;
    const newerProduction = await workflow.production.complete(adminId, {
      restaurantId,
      recipeVersionId: store.currentRecipeVersionId,
      producedQuantity: "1",
      notes: "Nueva receta vigente",
    });
    expect(newerProduction).toMatchObject({
      ok: true,
      value: {
        recipeVersionId: newerRecipeVersionId,
        recipeVersionNumber: 4,
        ingredients: [{ quantityConsumed: "3.000" }],
        output: { quantityProduced: "1.000" },
      },
    });
    expect(store.balance(rawItemId)).toBe(BigInt(4_000));
    expect(store.balance(outputItemId)).toBe(BigInt(3_000));
    expect(store.batches).toHaveLength(2);
    expect(store.batches[0]).toEqual(originalBatchSnapshot);
    expect(store.batches[0]).toMatchObject({
      recipeVersionId,
      recipeVersionNumber: 3,
      ingredients: [{ quantityConsumed: "4.000" }],
    });
    expect(Object.isFrozen(store.batches[0])).toBe(true);

    expect(store.movements.map((movement) => movement.type)).toEqual([
      "PURCHASE",
      "PURCHASE",
      "ADJUSTMENT",
      "WASTE",
      "SALE",
      "ROLLBACK",
      "PRODUCTION_CONSUMPTION",
      "PRODUCTION_OUTPUT",
      "PRODUCTION_CONSUMPTION",
      "PRODUCTION_OUTPUT",
    ]);
    expect(
      store.movements.every((movement) => movement.originId.length > 0),
    ).toBe(true);
    expect(store.movements.every((movement) => Object.isFrozen(movement))).toBe(
      true,
    );
    expect(store.audits.map((entry) => entry.action)).toEqual([
      "inventory_purchase.registered",
      "inventory_adjustment.registered",
      "inventory_waste.registered",
      "inventory_movement.sale_recorded",
      "order.confirmed",
      "inventory_movement.rollback_recorded",
      "order.cancelled",
      "production_batch.completed",
      "production_batch.completed",
    ]);
    expect(workflow.publisher.events.map((event) => event.type)).toEqual([
      "inventory.purchase.registered",
      "inventory.adjustment.registered",
      "inventory.waste.registered",
      "order.confirmed",
      "order.cancelled",
      "production.completed",
      "production.completed",
    ]);
    expect(workflow.boundary.commits).toBe(7);
  });

  it("honors negative-stock policy while always rejecting insufficient production atomically", async () => {
    const store = new InventoryProductionStore();
    const workflow = services(store);
    expect(store.allowNegativeStock).toBe(false);
    await workflow.purchase.register(adminId, {
      ...purchaseInput(),
      lines: [{ inventoryItemId: rawItemId, quantity: "1", unitPrice: "2" }],
    });
    const snapshot = () => ({
      balances: [...store.balances],
      movements: [...store.movements],
      audits: [...store.audits],
      batches: [...store.batches],
      events: [...workflow.publisher.events],
      commits: workflow.boundary.commits,
    });

    const beforeWaste = snapshot();
    await expect(
      workflow.movement.register(adminId, {
        restaurantId,
        inventoryItemId: rawItemId,
        operation: "WASTE",
        quantity: "2",
        reason: "Merma imposible",
      }),
    ).resolves.toEqual(err(adjustmentError("NEGATIVE_STOCK_DISALLOWED")));
    expect(snapshot()).toEqual(beforeWaste);

    const beforeProduction = snapshot();
    await expect(
      workflow.production.complete(adminId, {
        restaurantId,
        recipeVersionId,
        producedQuantity: "1",
      }),
    ).resolves.toEqual(err(productionError("INSUFFICIENT_INVENTORY")));
    expect(snapshot()).toEqual(beforeProduction);

    const beforeResale = snapshot();
    await expect(
      workflow.confirmation.confirm(waiterId, resaleOrderInput(1)),
    ).resolves.toEqual(err(orderConfirmationError("INSUFFICIENT_INVENTORY")));
    expect(snapshot()).toEqual(beforeResale);
    expect(
      [...store.balances.values()].every((balance) => balance >= BigInt(0)),
    ).toBe(true);

    const permissiveStore = new InventoryProductionStore(true);
    const permissiveWorkflow = services(permissiveStore);
    expect(permissiveStore.allowNegativeStock).toBe(true);
    await expect(
      permissiveWorkflow.movement.register(adminId, {
        restaurantId,
        inventoryItemId: rawItemId,
        operation: "WASTE",
        quantity: "2",
        reason: "Merma autorizada por configuración",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { previousBalance: "0.000", newBalance: "-2.000" },
    });
    expect(permissiveStore.balance(rawItemId)).toBe(BigInt(-2_000));

    const permissiveBeforeProduction = {
      balances: [...permissiveStore.balances],
      movements: [...permissiveStore.movements],
      audits: [...permissiveStore.audits],
      batches: [...permissiveStore.batches],
      events: [...permissiveWorkflow.publisher.events],
      commits: permissiveWorkflow.boundary.commits,
    };
    await expect(
      permissiveWorkflow.production.complete(adminId, {
        restaurantId,
        recipeVersionId,
        producedQuantity: "1",
      }),
    ).resolves.toEqual(err(productionError("INSUFFICIENT_INVENTORY")));
    expect({
      balances: [...permissiveStore.balances],
      movements: [...permissiveStore.movements],
      audits: [...permissiveStore.audits],
      batches: [...permissiveStore.batches],
      events: [...permissiveWorkflow.publisher.events],
      commits: permissiveWorkflow.boundary.commits,
    }).toEqual(permissiveBeforeProduction);
  });

  it("enforces server-side permissions before any protected inventory mutation", async () => {
    const store = new InventoryProductionStore();
    const workflow = services(store);
    const before = {
      balances: [...store.balances],
      movements: store.movements.length,
      audits: store.audits.length,
    };

    await expect(
      workflow.purchase.register(waiterId, purchaseInput()),
    ).resolves.toEqual(err(purchaseError("UNAUTHORIZED")));
    await expect(
      workflow.movement.register(waiterId, {
        restaurantId,
        inventoryItemId: rawItemId,
        operation: "ADJUSTMENT",
        quantity: "1",
        reason: "Sin permiso",
      }),
    ).resolves.toEqual(err(adjustmentError("UNAUTHORIZED")));
    await expect(
      workflow.movement.register(waiterId, {
        restaurantId,
        inventoryItemId: rawItemId,
        operation: "WASTE",
        quantity: "1",
        reason: "Sin permiso",
      }),
    ).resolves.toEqual(err(adjustmentError("UNAUTHORIZED")));
    await expect(
      workflow.production.complete(waiterId, {
        restaurantId,
        recipeVersionId,
        producedQuantity: "1",
      }),
    ).resolves.toEqual(err(productionError("UNAUTHORIZED")));

    expect({
      balances: [...store.balances],
      movements: store.movements.length,
      audits: store.audits.length,
    }).toEqual(before);
    expect(workflow.boundary.commits).toBe(0);
    expect(workflow.publisher.events).toEqual([]);
  });

  it("uses exact custom grants and rejects malformed mutations without rewriting history", async () => {
    const store = new InventoryProductionStore();
    const workflow = services(store);
    const snapshot = () => ({
      balances: [...store.balances],
      movements: structuredClone(store.movements),
      expenses: structuredClone(store.expenses),
      audits: structuredClone(store.audits),
      batches: structuredClone(store.batches),
      commits: workflow.boundary.commits,
      events: structuredClone(workflow.publisher.events),
    });

    const empty = snapshot();
    await expect(
      workflow.purchase.register(nominalAdministratorId, purchaseInput()),
    ).resolves.toEqual(err(purchaseError("UNAUTHORIZED")));
    expect(snapshot()).toEqual(empty);

    const purchase = await workflow.purchase.register(
      customInventoryOperatorId,
      purchaseInput(),
    );
    expect(purchase).toMatchObject({
      ok: true,
      value: { recordedById: customInventoryOperatorId },
    });
    const persistedPurchaseMovements = structuredClone(store.movements);
    const persistedPurchaseAudit = structuredClone(store.audits[0]);
    const afterPurchase = snapshot();

    await expect(
      workflow.purchase.register(customInventoryOperatorId, {
        ...purchaseInput(),
        lines: [
          { inventoryItemId: rawItemId, quantity: "1", unitPrice: "2" },
          { inventoryItemId: rawItemId, quantity: "1", unitPrice: "2" },
        ],
      }),
    ).resolves.toEqual(err(purchaseError("INVALID_PURCHASE")));
    await expect(
      workflow.movement.register(customInventoryOperatorId, {
        restaurantId,
        inventoryItemId: rawItemId,
        operation: "ADJUSTMENT",
        quantity: "0",
        reason: "Must not persist",
      }),
    ).resolves.toEqual(err(adjustmentError("INVALID_MOVEMENT")));
    await expect(
      workflow.movement.register(customInventoryOperatorId, {
        restaurantId,
        inventoryItemId: rawItemId,
        operation: "WASTE",
        quantity: "-1",
        reason: "Must not persist",
      }),
    ).resolves.toEqual(err(adjustmentError("INVALID_MOVEMENT")));
    await expect(
      workflow.production.complete(customInventoryOperatorId, {
        restaurantId,
        recipeVersionId,
        producedQuantity: "0",
        notes: "Must not persist",
      }),
    ).resolves.toEqual(err(productionError("INVALID_BATCH")));

    expect(snapshot()).toEqual(afterPurchase);
    expect(store.movements).toEqual(persistedPurchaseMovements);
    expect(store.audits[0]).toEqual(persistedPurchaseAudit);
    expect(store.movements.every((movement) => Object.isFrozen(movement))).toBe(
      true,
    );
    expect(Object.isFrozen(store.audits[0])).toBe(true);
  });
});
