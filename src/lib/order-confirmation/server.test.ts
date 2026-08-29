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
    constructor(client: unknown) {
      dependencies.realtimePublisher(client);
    }
  },
}));
vi.mock("../../application", () => ({
  OrderConfirmedRealtimePublisher: class {
    constructor(publisher: unknown) {
      dependencies.orderConfirmedPublisher(publisher);
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
  dependencies.operationRunner.mockReset();
  dependencies.service.mockReset();
  dependencies.createSupabaseAdminClient.mockReturnValue(dependencies.client);
});

describe("createOrderConfirmationService", () => {
  it("composes confirmation and realtime publication with one admin client", () => {
    createOrderConfirmationService();

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
    expect(dependencies.orderConfirmedPublisher).toHaveBeenCalledOnce();
    expect(dependencies.operationRunner).toHaveBeenCalledOnce();
    expect(dependencies.service).toHaveBeenCalledOnce();
  });
});
