import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  client: { name: "one-admin-client" },
  createSupabaseAdminClient: vi.fn(),
  authorizationReader: vi.fn(),
  gateway: vi.fn(),
  clock: vi.fn(),
  transaction: vi.fn(),
  realtimePublisher: vi.fn(),
  orderCancelledPublisher: vi.fn(),
  orderCancelledPublish: vi.fn(),
  inventoryAlertPublisher: vi.fn(),
  inventoryAlertPublish: vi.fn(),
  dispatcher: vi.fn(),
  subscribe: vi.fn(),
  operationRunner: vi.fn(),
  service: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../supabase/admin", () => ({
  createSupabaseAdminClient: dependencies.createSupabaseAdminClient,
}));
vi.mock("../../infrastructure/auth", () => ({
  SupabaseAuthorizationProfileReader: class {
    constructor(client: unknown) {
      dependencies.authorizationReader(client);
    }
  },
}));
vi.mock("../../infrastructure/orders", () => ({
  SupabaseOrderCancellationGateway: class {
    constructor(client: unknown) {
      dependencies.gateway(client);
    }
  },
  SupabaseOrderCancellationTransactionBoundary: class {
    constructor() {
      dependencies.transaction();
    }
  },
}));
vi.mock("../../infrastructure/audit", () => ({
  SystemAuditClock: class {
    constructor() {
      dependencies.clock();
    }
  },
}));
vi.mock("../../infrastructure/realtime", () => ({
  SupabaseRealtimePublisher: class {
    constructor(client: unknown) {
      dependencies.realtimePublisher(client);
    }
  },
}));
vi.mock("../../infrastructure/events", () => ({
  InProcessDomainEventPublisher: class {
    constructor() {
      dependencies.dispatcher();
    }
    subscribe(type: unknown, handler: unknown) {
      dependencies.subscribe(type, handler);
    }
  },
}));
vi.mock("../../application", () => ({
  InventoryAlertChangedRealtimePublisher: class {
    constructor(publisher: unknown) {
      dependencies.inventoryAlertPublisher(publisher);
    }
    publish(events: unknown) {
      return dependencies.inventoryAlertPublish(events);
    }
  },
  OrderCancelledRealtimePublisher: class {
    constructor(publisher: unknown) {
      dependencies.orderCancelledPublisher(publisher);
    }
    publish(events: unknown) {
      return dependencies.orderCancelledPublish(events);
    }
  },
  TransactionalOperationRunner: class {
    constructor(transaction: unknown, publisher: unknown) {
      dependencies.operationRunner(transaction, publisher);
    }
  },
  OrderCancellationService: class {
    constructor(
      profiles: unknown,
      gateway: unknown,
      clock: unknown,
      operations: unknown,
    ) {
      dependencies.service(profiles, gateway, clock, operations);
    }
  },
}));

import { createOrderCancellationService } from "./server";

beforeEach(() => {
  for (const dependency of Object.values(dependencies)) {
    if (typeof dependency === "function" && "mockReset" in dependency) {
      dependency.mockReset();
    }
  }
  dependencies.createSupabaseAdminClient.mockReturnValue(dependencies.client);
  dependencies.orderCancelledPublish.mockResolvedValue(undefined);
  dependencies.inventoryAlertPublish.mockResolvedValue(undefined);
});

describe("createOrderCancellationService", () => {
  it("composes cancellation and post-commit realtime with one admin client", async () => {
    createOrderCancellationService();

    expect(dependencies.createSupabaseAdminClient).toHaveBeenCalledOnce();
    expect(dependencies.authorizationReader).toHaveBeenCalledWith(
      dependencies.client,
    );
    expect(dependencies.gateway).toHaveBeenCalledWith(dependencies.client);
    expect(dependencies.realtimePublisher).toHaveBeenCalledWith(
      dependencies.client,
    );
    expect(dependencies.clock).toHaveBeenCalledOnce();
    expect(dependencies.transaction).toHaveBeenCalledOnce();
    expect(dependencies.dispatcher).toHaveBeenCalledOnce();
    expect(dependencies.orderCancelledPublisher).toHaveBeenCalledOnce();
    expect(dependencies.inventoryAlertPublisher).toHaveBeenCalledOnce();
    expect(dependencies.operationRunner).toHaveBeenCalledOnce();
    expect(dependencies.service).toHaveBeenCalledOnce();
    expect(dependencies.subscribe).toHaveBeenCalledWith(
      "order.cancelled",
      expect.any(Function),
    );
    expect(dependencies.subscribe).toHaveBeenCalledWith(
      "inventory.alert.changed",
      expect.any(Function),
    );

    const event = Object.freeze({
      type: "order.cancelled",
      occurredAt: "2026-08-30T10:00:00.000Z",
      payload: Object.freeze({ orderId: "order-id" }),
    });
    const handler = dependencies.subscribe.mock.calls[0]?.[1] as (
      event: unknown,
    ) => Promise<void>;
    await handler(event);

    expect(dependencies.orderCancelledPublish).toHaveBeenCalledWith([event]);

    const alertEvent = Object.freeze({ type: "inventory.alert.changed" });
    const alertHandler = dependencies.subscribe.mock.calls[1]?.[1] as (
      event: unknown,
    ) => Promise<void>;
    await alertHandler(alertEvent);
    expect(dependencies.inventoryAlertPublish).toHaveBeenCalledWith([
      alertEvent,
    ]);
  });
});
