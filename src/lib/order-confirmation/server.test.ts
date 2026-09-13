import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  client: { name: "one-admin-client" },
  createSupabaseAdminClient: vi.fn(),
  authorizationReader: vi.fn(),
  gateway: vi.fn(),
  clock: vi.fn(),
  transaction: vi.fn(),
  realtimePublisher: vi.fn(),
  orderConfirmedPublisher: vi.fn(),
  orderConfirmedPublish: vi.fn(),
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
  SupabaseOrderConfirmationGateway: class {
    constructor(client: unknown) {
      dependencies.gateway(client);
    }
  },
  SupabaseOrderConfirmationTransactionBoundary: class {
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
    constructor(...ports: unknown[]) {
      dependencies.realtimePublisher(...ports);
    }
  },
}));
vi.mock("../../infrastructure/events", () => ({
  InProcessDomainEventPublisher: class {
    constructor(...ports: unknown[]) {
      dependencies.dispatcher(...ports);
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
  OrderConfirmedRealtimePublisher: class {
    constructor(publisher: unknown) {
      dependencies.orderConfirmedPublisher(publisher);
    }
    publish(events: unknown) {
      return dependencies.orderConfirmedPublish(events);
    }
  },
  TransactionalOperationRunner: class {
    constructor(transaction: unknown, publisher: unknown) {
      dependencies.operationRunner(transaction, publisher);
    }
  },
  OrderConfirmationService: class {
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

import { createOrderConfirmationService } from "./server";

beforeEach(() => {
  dependencies.createSupabaseAdminClient.mockReset();
  dependencies.authorizationReader.mockReset();
  dependencies.gateway.mockReset();
  dependencies.clock.mockReset();
  dependencies.transaction.mockReset();
  dependencies.realtimePublisher.mockReset();
  dependencies.orderConfirmedPublisher.mockReset();
  dependencies.orderConfirmedPublish.mockReset();
  dependencies.inventoryAlertPublisher.mockReset();
  dependencies.inventoryAlertPublish.mockReset();
  dependencies.dispatcher.mockReset();
  dependencies.subscribe.mockReset();
  dependencies.operationRunner.mockReset();
  dependencies.service.mockReset();
  dependencies.createSupabaseAdminClient.mockReturnValue(dependencies.client);
  dependencies.orderConfirmedPublish.mockResolvedValue(undefined);
  dependencies.inventoryAlertPublish.mockResolvedValue(undefined);
});

describe("createOrderConfirmationService", () => {
  it("composes confirmation and realtime publication with one admin client", async () => {
    createOrderConfirmationService();

    expect(dependencies.createSupabaseAdminClient).toHaveBeenCalledOnce();
    expect(dependencies.authorizationReader).toHaveBeenCalledWith(
      dependencies.client,
    );
    expect(dependencies.gateway).toHaveBeenCalledWith(dependencies.client);
    expect(dependencies.realtimePublisher).toHaveBeenCalledWith(
      dependencies.client,
      expect.any(Object),
      expect.any(Object),
    );
    expect(dependencies.clock).toHaveBeenCalledOnce();
    expect(dependencies.transaction).toHaveBeenCalledOnce();
    expect(dependencies.orderConfirmedPublisher).toHaveBeenCalledOnce();
    expect(dependencies.inventoryAlertPublisher).toHaveBeenCalledOnce();
    expect(dependencies.dispatcher).toHaveBeenCalledOnce();
    expect(dependencies.operationRunner).toHaveBeenCalledOnce();
    expect(dependencies.service).toHaveBeenCalledOnce();
    expect(dependencies.subscribe).toHaveBeenCalledWith(
      "order.confirmed",
      expect.any(Function),
    );
    expect(dependencies.subscribe).toHaveBeenCalledWith(
      "inventory.alert.changed",
      expect.any(Function),
    );

    const orderEvent = Object.freeze({ type: "order.confirmed" });
    const orderHandler = dependencies.subscribe.mock.calls[0]?.[1] as (
      event: unknown,
    ) => Promise<void>;
    await orderHandler(orderEvent);
    expect(dependencies.orderConfirmedPublish).toHaveBeenCalledWith([
      orderEvent,
    ]);

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
