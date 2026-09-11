import { describe, expect, it, vi } from "vitest";

import {
  OrderCancellationService,
  OrderCancelledRealtimePublisher,
  OrderConfirmationService,
  OrderConfirmedRealtimePublisher,
  OrderDeliveredRealtimePublisher,
  OrderDeliveredService,
  OrderOnTheWayRealtimePublisher,
  OrderOnTheWayService,
  OrderReadyRealtimePublisher,
  OrderReadyService,
  PaymentCompletedRealtimePublisher,
  PaymentRegistrationService,
  TransactionalOperationRunner,
  mapDomainEventToRealtime,
  parseRealtimeMessage,
  type AuthorizationProfile,
  type AuthorizationProfileReader,
  type CancelledOrder,
  type ConfirmedOrder,
  type DomainEventPublisher,
  type MarkOrderDeliveredCommand,
  type MarkOrderOnTheWayCommand,
  type MarkOrderReadyCommand,
  type OrderCancellationCommand,
  type OrderCancellationError,
  type OrderCancellationGateway,
  type OrderConfirmationCommand,
  type OrderConfirmationError,
  type OrderConfirmationGateway,
  type OrderDeliveredError,
  type OrderDeliveredGateway,
  type OrderOnTheWayError,
  type OrderOnTheWayGateway,
  type OrderReadyError,
  type OrderReadyGateway,
  type PaymentRegistrationError,
  type PaymentRegistrationGateway,
  type RealtimeDomainEvent,
  type RealtimePublication,
  type RealtimeSubscriber,
  type RealtimeSubscriptionRequest,
  type ReadyOrder,
  type RegisterPaymentCommand,
  type RegisteredPayment,
  type TransactionBoundary,
} from "../application";
import {
  err,
  ok,
  type InventoryAlertChanged,
  type OrderCancelled,
  type OrderConfirmed,
  type OrderDelivered,
  type OrderOnTheWay,
  type OrderReady,
  type PaymentCompleted,
  type Result,
} from "../domain";
import {
  createDraftLine,
  draftReducer,
  initialDraftState,
  type DraftState,
} from "../app/(authenticated)/orders/draft-state";
import {
  DraftConfirmationWorkflow,
  toConfirmationInput,
} from "../app/(authenticated)/orders/draft-confirmation";
import { KitchenQueueRealtimeController } from "../app/(authenticated)/kitchen/kitchen-display";
import { DeliveryQueueRealtimeController } from "../app/(authenticated)/delivery/delivery-display";
import { PaymentRealtimeController } from "../app/(authenticated)/payments/payment-display";
import { authenticatePassword } from "../lib/auth/auth-actions";

const waiterId = "10000000-0000-4000-8000-000000000001";
const kitchenId = "10000000-0000-4000-8000-000000000002";
const adminId = "10000000-0000-4000-8000-000000000003";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const productVersionId = "36000000-0000-4000-8000-000000000001";
const paymentMethodId = "43000000-0000-4000-8000-000000000001";

type LifecycleStatus =
  "PENDING" | "READY" | "ON_THE_WAY" | "DELIVERED" | "PAID" | "CANCELLED";

type StoredPayment = Readonly<{
  id: string;
  amount: string;
  recordedAt: string;
}>;

type StoredBasket = {
  id: string;
  totalCents: bigint;
  paidCents: bigint;
  status: "PENDING" | "PAID";
  payments: StoredPayment[];
};

type HistoryEntry = Readonly<{
  status: LifecycleStatus;
  actorId: string;
  occurredAt: string;
  reason?: string;
}>;

type StoredOrder = {
  id: string;
  orderNumber: string;
  assignedWaiterId: string;
  status: LifecycleStatus;
  totalCents: bigint;
  baskets: StoredBasket[];
  lineSnapshots: readonly Readonly<{
    productVersionId: string;
    quantity: number;
  }>[];
  history: HistoryEntry[];
  readyAt: string | null;
  onTheWayAt: string | null;
  deliveredAt: string | null;
  paidAt: string | null;
  cancellationReason: string | null;
  inventoryRollbackCount: number;
};

const product = Object.freeze({
  id: "35000000-0000-4000-8000-000000000001",
  productVersionId,
  versionNumber: 1,
  name: "Taco",
  printerAlias: "COCINA",
  displayOrder: 1,
  unitPrice: 5,
  tax: Object.freeze({
    taxRateId: "34000000-0000-4000-8000-000000000001",
    code: "IVA",
    name: "IVA",
    rate: 0.15,
    priceIncludesTax: true,
  }),
  options: Object.freeze([]),
  removableIngredients: Object.freeze([]),
});

class RecordingBoundary implements TransactionBoundary {
  commits = 0;

  async run<T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    const result = await work();
    if (result.ok) this.commits += 1;
    return result;
  }
}

class RealtimeHarness
  implements DomainEventPublisher<RealtimeDomainEvent>, RealtimeSubscriber
{
  readonly publications: Array<
    RealtimePublication & Readonly<{ observedAfterCommit: number }>
  > = [];
  private readonly subscriptions = new Set<RealtimeSubscriptionRequest>();

  constructor(private readonly boundary: RecordingBoundary) {}

  async publish(events: readonly RealtimeDomainEvent[]): Promise<void> {
    for (const event of events) {
      const result = mapDomainEventToRealtime(event);
      if (!result.ok) throw new Error("invalid lifecycle realtime event");

      for (const publication of result.value) {
        this.publications.push({
          ...publication,
          observedAfterCommit: this.boundary.commits,
        });
        for (const subscription of this.subscriptions) {
          if (
            subscription.restaurantId !== publication.envelope.restaurantId ||
            subscription.topic !== publication.topic
          ) {
            continue;
          }
          const message = parseRealtimeMessage(
            publication.eventName,
            publication.envelope,
            subscription.restaurantId,
            subscription.topic,
          );
          if (message !== null) subscription.onMessage(message);
        }
      }
    }
  }

  async subscribe(request: RealtimeSubscriptionRequest) {
    this.subscriptions.add(request);
    return {
      unsubscribe: async () => {
        this.subscriptions.delete(request);
      },
    };
  }
}

type LifecycleEvent =
  | OrderConfirmed
  | OrderReady
  | OrderOnTheWay
  | OrderDelivered
  | PaymentCompleted
  | OrderCancelled
  | InventoryAlertChanged;

class LifecycleEventPublisher implements DomainEventPublisher<LifecycleEvent> {
  private readonly confirmation: OrderConfirmedRealtimePublisher;
  private readonly ready: OrderReadyRealtimePublisher;
  private readonly onTheWay: OrderOnTheWayRealtimePublisher;
  private readonly delivered: OrderDeliveredRealtimePublisher;
  private readonly payment: PaymentCompletedRealtimePublisher;
  private readonly cancellation: OrderCancelledRealtimePublisher;

  constructor(realtime: RealtimeHarness) {
    this.confirmation = new OrderConfirmedRealtimePublisher(realtime);
    this.ready = new OrderReadyRealtimePublisher(realtime);
    this.onTheWay = new OrderOnTheWayRealtimePublisher(realtime);
    this.delivered = new OrderDeliveredRealtimePublisher(realtime);
    this.payment = new PaymentCompletedRealtimePublisher(realtime);
    this.cancellation = new OrderCancelledRealtimePublisher(realtime);
  }

  async publish(events: readonly LifecycleEvent[]): Promise<void> {
    for (const event of events) {
      switch (event.type) {
        case "order.confirmed":
          await this.confirmation.publish([event]);
          break;
        case "order.ready":
          await this.ready.publish([event]);
          break;
        case "order.on-the-way":
          await this.onTheWay.publish([event]);
          break;
        case "order.delivered":
          await this.delivered.publish([event]);
          break;
        case "payment.completed":
          await this.payment.publish([event]);
          break;
        case "order.cancelled":
          await this.cancellation.publish([event]);
          break;
        case "inventory.alert.changed":
          throw new Error("the lifecycle fixture emitted an unexpected alert");
      }
    }
  }
}

class LifecycleStore
  implements
    OrderConfirmationGateway,
    OrderReadyGateway,
    OrderOnTheWayGateway,
    OrderDeliveredGateway,
    PaymentRegistrationGateway,
    OrderCancellationGateway
{
  readonly orders: StoredOrder[] = [];

  async confirm(
    command: OrderConfirmationCommand,
  ): Promise<Result<ConfirmedOrder, OrderConfirmationError>> {
    const sequence = this.orders.length + 1;
    const id = numberedUuid("41000000-0000-4000-8000", sequence);
    const baskets = command.baskets.map((basket, index) => ({
      id: numberedUuid("42000000-0000-4000-8000", sequence * 10 + index),
      totalCents: index === 0 ? BigInt(1_000) : BigInt(1_500),
      paidCents: BigInt(0),
      status: "PENDING" as const,
      payments: [],
    }));
    const totalCents = baskets.reduce(
      (sum, basket) => sum + basket.totalCents,
      BigInt(0),
    );
    const lineSnapshots = Object.freeze(
      command.baskets.flatMap((basket) =>
        basket.lines.map((line) =>
          Object.freeze({
            productVersionId: line.productVersionId,
            quantity: line.quantity,
          }),
        ),
      ),
    );
    const order: StoredOrder = {
      id,
      orderNumber: `ORD-${sequence}`,
      assignedWaiterId: command.actorId,
      status: "PENDING",
      totalCents,
      baskets,
      lineSnapshots,
      history: [
        {
          status: "PENDING",
          actorId: command.actorId,
          occurredAt: command.occurredAt,
        },
      ],
      readyAt: null,
      onTheWayAt: null,
      deliveredAt: null,
      paidAt: null,
      cancellationReason: null,
      inventoryRollbackCount: 0,
    };
    this.orders.push(order);

    return ok({
      orderId: id,
      restaurantId,
      serviceLocationId: command.serviceLocationId,
      orderNumber: order.orderNumber,
      assignedWaiterId: command.actorId,
      status: "PENDING",
      notes: command.notes,
      totalAmount: money(totalCents),
      confirmedAt: command.occurredAt,
      baskets: baskets.map((basket, index) => ({
        id: basket.id,
        status: "PENDING",
        totalAmount: money(basket.totalCents),
        lines: command.baskets[index]!.lines.map((line, lineIndex) => ({
          id: numberedUuid(
            "44000000-0000-4000-8000",
            sequence * 100 + index * 10 + lineIndex,
          ),
          productVersionId: line.productVersionId,
          productName: "Taco",
          quantity: line.quantity,
          baseUnitPrice: "5.00",
          finalUnitPrice: "5.00",
          lineTotal: money(basket.totalCents),
          taxCode: "IVA",
          taxName: "IVA",
          taxRate: "0.150000",
          priceIncludesTax: true,
          selectedOptions: [],
          removedIngredients: [],
          observations: line.observations,
        })),
      })),
    });
  }

  async markReady(
    command: MarkOrderReadyCommand,
  ): Promise<Result<ReadyOrder, OrderReadyError>> {
    const order = this.order(command.orderId);
    if (order === null) return err(orderReadyError("NOT_FOUND"));
    if (order.status !== "PENDING") {
      return err(orderReadyError("ORDER_NOT_PENDING"));
    }
    order.status = "READY";
    order.readyAt = command.occurredAt;
    order.history.push({
      status: "READY",
      actorId: command.actorId,
      occurredAt: command.occurredAt,
    });
    return ok({
      ...operationalOrder(order),
      previousStatus: "PENDING",
      status: "READY",
      markedReadyById: command.actorId,
      readyAt: command.occurredAt,
      updatedAt: command.occurredAt,
    });
  }

  async markOnTheWay(
    command: MarkOrderOnTheWayCommand,
  ): Promise<Result<ReturnType<typeof onTheWayResult>, OrderOnTheWayError>> {
    const order = this.order(command.orderId);
    if (order === null) return err(orderOnTheWayError("NOT_FOUND"));
    if (order.status !== "READY" || order.readyAt === null) {
      return err(orderOnTheWayError("ORDER_NOT_READY"));
    }
    order.status = "ON_THE_WAY";
    order.onTheWayAt = command.occurredAt;
    order.history.push({
      status: "ON_THE_WAY",
      actorId: command.actorId,
      occurredAt: command.occurredAt,
    });
    return ok(onTheWayResult(order, command));
  }

  async markDelivered(
    command: MarkOrderDeliveredCommand,
  ): Promise<Result<ReturnType<typeof deliveredResult>, OrderDeliveredError>> {
    const order = this.order(command.orderId);
    if (order === null) return err(orderDeliveredError("NOT_FOUND"));
    if (
      order.status !== "ON_THE_WAY" ||
      order.readyAt === null ||
      order.onTheWayAt === null
    ) {
      return err(orderDeliveredError("ORDER_NOT_ON_THE_WAY"));
    }
    order.status = "DELIVERED";
    order.deliveredAt = command.occurredAt;
    order.history.push({
      status: "DELIVERED",
      actorId: command.actorId,
      occurredAt: command.occurredAt,
    });
    return ok(deliveredResult(order, command));
  }

  async register(
    command: RegisterPaymentCommand,
  ): Promise<Result<RegisteredPayment, PaymentRegistrationError>> {
    const order = this.orders.find((candidate) =>
      candidate.baskets.some((basket) => basket.id === command.basketId),
    );
    const basket = order?.baskets.find(
      (candidate) => candidate.id === command.basketId,
    );
    if (order === undefined || basket === undefined) {
      return err(paymentError("NOT_FOUND"));
    }
    if (order.status !== "DELIVERED") {
      return err(paymentError("ORDER_NOT_DELIVERED"));
    }
    if (basket.status === "PAID") {
      return err(paymentError("BASKET_ALREADY_PAID"));
    }
    const amountCents = BigInt(command.amount.replace(".", ""));
    const outstanding = basket.totalCents - basket.paidCents;
    if (amountCents > outstanding && command.overageReason === null) {
      return err(paymentError("OVERAGE_REASON_REQUIRED"));
    }

    const previousStatus = order.status;
    const paymentId = numberedUuid(
      "45000000-0000-4000-8000",
      basket.payments.length +
        this.orders.reduce(
          (count, candidate) =>
            count +
            candidate.baskets.reduce(
              (payments, entry) => payments + entry.payments.length,
              0,
            ),
          1,
        ),
    );
    basket.paidCents += amountCents;
    basket.status = basket.paidCents >= basket.totalCents ? "PAID" : "PENDING";
    basket.payments.push({
      id: paymentId,
      amount: command.amount,
      recordedAt: command.occurredAt,
    });
    if (order.baskets.every((entry) => entry.status === "PAID")) {
      order.status = "PAID";
      order.paidAt = command.occurredAt;
      order.history.push({
        status: "PAID",
        actorId: command.actorId,
        occurredAt: command.occurredAt,
      });
    }
    const balance =
      basket.paidCents >= basket.totalCents
        ? BigInt(0)
        : basket.totalCents - basket.paidCents;
    return ok({
      paymentId,
      restaurantId,
      orderId: order.id,
      basketId: basket.id,
      paymentMethodId: command.paymentMethodId,
      recordedById: command.actorId,
      amount: command.amount,
      paymentMethodCode: "cash",
      paymentMethodName: "Efectivo",
      referenceNumber: command.referenceNumber,
      comments: command.comments,
      recordedAt: command.occurredAt,
      overageAuthorizedById: amountCents > outstanding ? command.actorId : null,
      overageAuthorizedAt:
        amountCents > outstanding ? command.occurredAt : null,
      overageReason: command.overageReason,
      basketTotalAmount: money(basket.totalCents),
      basketPaidAmount: money(basket.paidCents),
      basketOutstandingBalance: money(balance),
      basketPreviousStatus: "PENDING",
      basketStatus: basket.status,
      orderPreviousStatus: previousStatus,
      orderStatus: order.status === "PAID" ? "PAID" : "DELIVERED",
      orderPaidAt: order.paidAt,
    });
  }

  async cancel(
    command: OrderCancellationCommand,
  ): Promise<Result<CancelledOrder, OrderCancellationError>> {
    const order = this.order(command.orderId);
    if (order === null) return err(cancellationError("NOT_FOUND"));
    if (order.status !== "PENDING" && order.status !== "READY") {
      return err(cancellationError("ORDER_NOT_CANCELLABLE"));
    }
    const previousStatus = order.status;
    order.status = "CANCELLED";
    order.cancellationReason = command.reason;
    order.inventoryRollbackCount = order.lineSnapshots.length;
    order.history.push({
      status: "CANCELLED",
      actorId: command.actorId,
      occurredAt: command.occurredAt,
      reason: command.reason,
    });
    return ok({
      orderId: order.id,
      restaurantId,
      serviceLocationId: locationId,
      orderNumber: order.orderNumber,
      assignedWaiterId: order.assignedWaiterId,
      previousStatus,
      status: "CANCELLED",
      totalAmount: money(order.totalCents),
      reason: command.reason,
      cancelledById: command.actorId,
      cancelledAt: command.occurredAt,
      updatedAt: command.occurredAt,
      inventoryMovements: order.lineSnapshots.map((line, index) => ({
        inventoryMovementId: numberedUuid("46000000-0000-4000-8000", index + 1),
        inventoryItemId: numberedUuid("47000000-0000-4000-8000", index + 1),
        type: "ROLLBACK",
        quantityDelta: `${line.quantity}.000`,
        unitOfMeasure: "each",
        reversedMovementId: numberedUuid("48000000-0000-4000-8000", index + 1),
      })),
    });
  }

  private order(orderId: string): StoredOrder | null {
    return this.orders.find((order) => order.id === orderId) ?? null;
  }
}

function profiles(): AuthorizationProfileReader {
  const byId = new Map<string, AuthorizationProfile>([
    [
      waiterId,
      profile(waiterId, "waiter", [
        "orders.create",
        "delivery.on_the_way.mark",
        "delivery.delivered.mark",
        "payments.register",
      ]),
    ],
    [kitchenId, profile(kitchenId, "kitchen", ["kitchen.ready.mark"])],
    [
      adminId,
      profile(adminId, "administrator", [
        "orders.cancel",
        "delivery.on_the_way.mark",
        "delivery.delivered.mark",
        "payments.register",
        "payments.overage.authorize",
      ]),
    ],
  ]);
  return {
    findByAuthenticatedUserId: async (userId) => byId.get(userId) ?? null,
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

function runner<Event extends LifecycleEvent>(
  boundary: RecordingBoundary,
  publisher: LifecycleEventPublisher,
) {
  return new TransactionalOperationRunner<Event>(boundary, {
    publish: (events) => publisher.publish(events),
  });
}

function services(store: LifecycleStore, boundary: RecordingBoundary) {
  const authorizationProfiles = profiles();
  const realtime = new RealtimeHarness(boundary);
  const publisher = new LifecycleEventPublisher(realtime);
  return {
    realtime,
    confirmation: new OrderConfirmationService(
      authorizationProfiles,
      store,
      fixedClock("2026-09-10T15:00:00.000Z"),
      runner<OrderConfirmed | InventoryAlertChanged>(boundary, publisher),
    ),
    ready: new OrderReadyService(
      authorizationProfiles,
      store,
      fixedClock("2026-09-10T15:05:00.000Z"),
      runner<OrderReady>(boundary, publisher),
    ),
    onTheWay: new OrderOnTheWayService(
      authorizationProfiles,
      store,
      fixedClock("2026-09-10T15:10:00.000Z"),
      runner<OrderOnTheWay>(boundary, publisher),
    ),
    delivered: new OrderDeliveredService(
      authorizationProfiles,
      store,
      fixedClock("2026-09-10T15:15:00.000Z"),
      runner<OrderDelivered>(boundary, publisher),
    ),
    payment: new PaymentRegistrationService(
      authorizationProfiles,
      store,
      fixedClock("2026-09-10T15:20:00.000Z"),
      runner<PaymentCompleted>(boundary, publisher),
    ),
    cancellation: new OrderCancellationService(
      authorizationProfiles,
      store,
      fixedClock("2026-09-10T15:25:00.000Z"),
      runner<OrderCancelled | InventoryAlertChanged>(boundary, publisher),
    ),
  };
}

function buildTwoBasketDraft(): DraftState {
  let draft = draftReducer(initialDraftState, {
    type: "select-location",
    locationId,
    restaurantId,
  });
  draft = draftReducer(draft, {
    type: "add-line",
    line: createDraftLine({
      id: "general-line",
      basketId: "general",
      product,
      selectedOptionIds: [],
      selectedRemovalIds: [],
      observation: "",
      quantity: 2,
    }),
  });
  draft = draftReducer(draft, {
    type: "add-basket",
    basket: { id: "guest-ana", name: "Ana" },
  });
  return draftReducer(draft, {
    type: "add-line",
    line: createDraftLine({
      id: "ana-line",
      basketId: "guest-ana",
      product,
      selectedOptionIds: [],
      selectedRemovalIds: [],
      observation: "Sin cebolla",
      quantity: 3,
    }),
  });
}

function signInForm(): FormData {
  const form = new FormData();
  form.set("email", "waiter@carnales.example");
  form.set("password", "private-password");
  form.set("next", "/orders");
  return form;
}

function fixedClock(instant: string) {
  return { now: () => new Date(instant) };
}

function money(cents: bigint): string {
  const canonical = cents.toString().padStart(3, "0");
  return `${canonical.slice(0, -2)}.${canonical.slice(-2)}`;
}

function numberedUuid(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(12, "0")}`;
}

function operationalOrder(order: StoredOrder) {
  return {
    orderId: order.id,
    restaurantId,
    serviceLocationId: locationId,
    orderNumber: order.orderNumber,
    assignedWaiterId: order.assignedWaiterId,
  };
}

function onTheWayResult(order: StoredOrder, command: MarkOrderOnTheWayCommand) {
  return {
    ...operationalOrder(order),
    previousStatus: "READY" as const,
    status: "ON_THE_WAY" as const,
    collectedById: command.actorId,
    readyAt: order.readyAt!,
    onTheWayAt: command.occurredAt,
    updatedAt: command.occurredAt,
  };
}

function deliveredResult(
  order: StoredOrder,
  command: MarkOrderDeliveredCommand,
) {
  return {
    ...operationalOrder(order),
    previousStatus: "ON_THE_WAY" as const,
    status: "DELIVERED" as const,
    deliveredById: command.actorId,
    readyAt: order.readyAt!,
    onTheWayAt: order.onTheWayAt!,
    deliveredAt: command.occurredAt,
    updatedAt: command.occurredAt,
  };
}

function orderReadyError(code: OrderReadyError["code"]): OrderReadyError {
  return { kind: "order-ready-error", code };
}

function orderOnTheWayError(
  code: OrderOnTheWayError["code"],
): OrderOnTheWayError {
  return { kind: "order-on-the-way-error", code };
}

function orderDeliveredError(
  code: OrderDeliveredError["code"],
): OrderDeliveredError {
  return { kind: "order-delivered-error", code };
}

function paymentError(
  code: PaymentRegistrationError["code"],
): PaymentRegistrationError {
  return { kind: "payment-registration-error", code };
}

function cancellationError(
  code: OrderCancellationError["code"],
): OrderCancellationError {
  return { kind: "order-cancellation-error", code };
}

async function flushRealtime(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("core order lifecycle end-to-end", () => {
  it("signs in, keeps the draft client-only, and completes split settlement through live views", async () => {
    const store = new LifecycleStore();
    const boundary = new RecordingBoundary();
    const lifecycle = services(store, boundary);
    let authenticatedUserId: string | null = null;
    const signInWithPassword = vi.fn(async () => {
      authenticatedUserId = waiterId;
      return { error: null };
    });

    await expect(
      authenticatePassword(signInForm(), { signInWithPassword }),
    ).resolves.toEqual({ ok: true, nextPath: "/orders" });
    expect(authenticatedUserId).toBe(waiterId);

    let draft = buildTwoBasketDraft();
    const privateDraftSnapshot = structuredClone(draft);
    expect(store.orders).toHaveLength(0);
    expect(toConfirmationInput(draft)?.baskets).toHaveLength(2);

    const kitchenVisible: LifecycleStatus[][] = [];
    const deliveryVisible: LifecycleStatus[][] = [];
    const paymentVisible: LifecycleStatus[][] = [];
    const kitchenController = new KitchenQueueRealtimeController({
      subscriber: lifecycle.realtime,
      restaurantIds: [restaurantId],
      refreshQueue: async () => {
        kitchenVisible.push(
          store.orders
            .filter((order) => order.status === "PENDING")
            .map((order) => order.status),
        );
      },
      onStatus: vi.fn(),
    });
    const deliveryController = new DeliveryQueueRealtimeController({
      subscriber: lifecycle.realtime,
      restaurantIds: [restaurantId],
      refreshQueue: async () => {
        deliveryVisible.push(
          store.orders
            .filter((order) => ["READY", "ON_THE_WAY"].includes(order.status))
            .map((order) => order.status),
        );
      },
      onStatus: vi.fn(),
    });
    const paymentController = new PaymentRealtimeController({
      subscriber: lifecycle.realtime,
      restaurantIds: [restaurantId],
      refreshPayments: async () => {
        paymentVisible.push(store.orders.map((order) => order.status));
      },
      onStatus: vi.fn(),
    });
    await Promise.all([
      kitchenController.start(),
      deliveryController.start(),
      paymentController.start(),
    ]);

    const confirmationStates: unknown[] = [];
    const workflow = new DraftConfirmationWorkflow(
      async (input) => {
        const result = await lifecycle.confirmation.confirm(
          authenticatedUserId!,
          input,
        );
        return result.ok
          ? { status: 201, json: async () => result.value }
          : { status: 422, json: async () => result.error };
      },
      (state) => confirmationStates.push(state),
      () => {
        draft = draftReducer(draft, { type: "clear" });
      },
    );
    await workflow.submit(toConfirmationInput(draft));
    await flushRealtime();

    expect(privateDraftSnapshot.lines).toHaveLength(2);
    expect(draft).toEqual(initialDraftState);
    expect(store.orders[0]).toMatchObject({
      status: "PENDING",
      totalCents: BigInt(2_500),
      baskets: [
        { totalCents: BigInt(1_000), status: "PENDING" },
        { totalCents: BigInt(1_500), status: "PENDING" },
      ],
    });
    expect(confirmationStates).toEqual([
      { status: "pending" },
      { status: "success", orderNumber: "ORD-1" },
    ]);

    const order = store.orders[0]!;
    await expect(
      lifecycle.ready.markReady(kitchenId, { orderId: order.id }),
    ).resolves.toMatchObject({ ok: true, value: { status: "READY" } });
    await expect(
      lifecycle.onTheWay.markOnTheWay(adminId, { orderId: order.id }),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: "ON_THE_WAY", collectedById: adminId },
    });
    await expect(
      lifecycle.delivered.markDelivered(waiterId, { orderId: order.id }),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: "DELIVERED", deliveredById: waiterId },
    });

    const [firstBasket, secondBasket] = order.baskets;
    const firstPartial = await lifecycle.payment.register(waiterId, {
      basketId: firstBasket!.id,
      paymentMethodId,
      amount: "4",
    });
    expect(firstPartial).toMatchObject({
      ok: true,
      value: {
        basketPaidAmount: "4.00",
        basketOutstandingBalance: "6.00",
        basketStatus: "PENDING",
        orderStatus: "DELIVERED",
      },
    });
    const firstSettlement = await lifecycle.payment.register(waiterId, {
      basketId: firstBasket!.id,
      paymentMethodId,
      amount: "6.00",
    });
    expect(firstSettlement).toMatchObject({
      ok: true,
      value: {
        basketStatus: "PAID",
        orderStatus: "DELIVERED",
      },
    });
    const finalSettlement = await lifecycle.payment.register(waiterId, {
      basketId: secondBasket!.id,
      paymentMethodId,
      amount: "15.00",
    });
    expect(finalSettlement).toMatchObject({
      ok: true,
      value: {
        basketStatus: "PAID",
        orderStatus: "PAID",
        orderPaidAt: "2026-09-10T15:20:00.000Z",
      },
    });
    await expect(
      lifecycle.payment.register(waiterId, {
        basketId: secondBasket!.id,
        paymentMethodId,
        amount: "1.00",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ORDER_NOT_DELIVERED" },
    });
    await flushRealtime();

    expect(order.status).toBe("PAID");
    expect(order.history.map((entry) => entry.status)).toEqual([
      "PENDING",
      "READY",
      "ON_THE_WAY",
      "DELIVERED",
      "PAID",
    ]);
    expect(firstBasket!.payments.map((payment) => payment.amount)).toEqual([
      "4.00",
      "6.00",
    ]);
    expect(secondBasket!.payments.map((payment) => payment.amount)).toEqual([
      "15.00",
    ]);
    expect(kitchenVisible).toContainEqual(["PENDING"]);
    expect(deliveryVisible).toContainEqual(["READY"]);
    expect(deliveryVisible).toContainEqual(["ON_THE_WAY"]);
    expect(paymentVisible).toContainEqual(["DELIVERED"]);
    expect(paymentVisible.at(-1)).toEqual(["PAID"]);
    expect(
      lifecycle.realtime.publications.map((entry) => entry.eventName),
    ).toEqual(
      expect.arrayContaining([
        "order.created",
        "kitchen.status.updated",
        "delivery.status.updated",
        "payment.completed",
      ]),
    );
    expect(
      lifecycle.realtime.publications.every(
        (entry) => entry.observedAfterCommit > 0,
      ),
    ).toBe(true);
    const kitchenReadyPublications = lifecycle.realtime.publications.filter(
      (entry) =>
        entry.topic === "kitchen" &&
        entry.eventName === "kitchen.status.updated",
    );
    expect(JSON.stringify(kitchenReadyPublications)).not.toMatch(
      /amount|balance|payment|price/i,
    );

    await Promise.all([
      kitchenController.stop(),
      deliveryController.stop(),
      paymentController.stop(),
    ]);
  });

  it("requires cancellation permission and reason, then preserves terminal history and rollback", async () => {
    const store = new LifecycleStore();
    const boundary = new RecordingBoundary();
    const lifecycle = services(store, boundary);
    const draft = buildTwoBasketDraft();
    const confirmation = await lifecycle.confirmation.confirm(
      waiterId,
      toConfirmationInput(draft)!,
    );
    if (!confirmation.ok) throw new Error("fixture confirmation failed");
    const order = store.orders[0]!;
    const originalLines = structuredClone(order.lineSnapshots);

    await expect(
      lifecycle.cancellation.cancel(waiterId, {
        orderId: order.id,
        reason: "Customer changed plans",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
    await expect(
      lifecycle.cancellation.cancel(adminId, {
        orderId: order.id,
        reason: "   ",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_CANCELLATION" },
    });
    expect(order.status).toBe("PENDING");

    const cancellation = await lifecycle.cancellation.cancel(adminId, {
      orderId: order.id,
      reason: "  Customer   changed plans  ",
    });
    expect(cancellation).toMatchObject({
      ok: true,
      value: {
        status: "CANCELLED",
        cancelledById: adminId,
        reason: "Customer changed plans",
      },
    });
    expect(order.lineSnapshots).toEqual(originalLines);
    expect(order.inventoryRollbackCount).toBe(originalLines.length);
    expect(order.history.at(-1)).toEqual({
      status: "CANCELLED",
      actorId: adminId,
      occurredAt: "2026-09-10T15:25:00.000Z",
      reason: "Customer changed plans",
    });

    await expect(
      lifecycle.ready.markReady(kitchenId, { orderId: order.id }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ORDER_NOT_PENDING" },
    });
    await expect(
      lifecycle.payment.register(waiterId, {
        basketId: order.baskets[0]!.id,
        paymentMethodId,
        amount: "1.00",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ORDER_NOT_DELIVERED" },
    });
    expect(order.status).toBe("CANCELLED");
    expect(order.history.map((entry) => entry.status)).toEqual([
      "PENDING",
      "CANCELLED",
    ]);
    expect(
      lifecycle.realtime.publications.some(
        (entry) =>
          entry.eventName === "order.cancelled" &&
          entry.envelope.data.reason === "Customer changed plans",
      ),
    ).toBe(true);
  });
});
