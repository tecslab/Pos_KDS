import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorizationReader: vi.fn(),
  client: { name: "one-admin-client" },
  createSupabaseAdminClient: vi.fn(),
  dispatch: vi.fn(),
  noOpPrinter: vi.fn(),
  preparationFailure: vi.fn(),
  service: vi.fn(),
  snapshotReader: vi.fn(),
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
vi.mock("../../infrastructure/payments", () => ({
  SupabasePaymentReceiptSnapshotReader: class {
    constructor(client: unknown) {
      dependencies.snapshotReader(client);
    }
  },
}));
vi.mock("../../infrastructure/printing", () => ({
  NoOpPrinterService: class {
    constructor(logger: unknown) {
      dependencies.noOpPrinter(logger);
    }
  },
}));
vi.mock("../../application", () => ({
  PaymentReceiptService: class {
    constructor(...ports: unknown[]) {
      dependencies.service(...ports);
    }

    dispatch(actorId: unknown, payment: unknown) {
      return dependencies.dispatch(actorId, payment);
    }
  },
  paymentReceiptPreparationFailure: dependencies.preparationFailure,
}));

import {
  createPaymentReceiptService,
  dispatchPaymentReceiptAfterPersistence,
} from "./server";

const actorId = "10000000-0000-4000-8000-000000000001";
const payment = Object.freeze({
  paymentId: "44000000-0000-4000-8000-000000000001",
});
const failed = Object.freeze({
  status: "failed",
  jobId: `payment-receipt:${payment.paymentId}`,
  attemptId: null,
  failure: Object.freeze({
    code: "RECEIPT_PREPARATION_FAILED",
    retryable: false,
  }),
  retry: Object.freeze({ action: "STOP" }),
});

beforeEach(() => {
  for (const dependency of Object.values(dependencies)) {
    if (typeof dependency === "function" && "mockReset" in dependency) {
      dependency.mockReset();
    }
  }
  dependencies.createSupabaseAdminClient.mockReturnValue(dependencies.client);
  dependencies.dispatch.mockResolvedValue({ status: "skipped" });
  dependencies.preparationFailure.mockReturnValue(failed);
});

describe("payment receipt server composition", () => {
  it("composes authorization, immutable snapshot reading, and no-op printing with one admin client", () => {
    const logger = { log: vi.fn() };

    createPaymentReceiptService(logger);

    expect(dependencies.createSupabaseAdminClient).toHaveBeenCalledOnce();
    expect(dependencies.authorizationReader).toHaveBeenCalledWith(
      dependencies.client,
    );
    expect(dependencies.snapshotReader).toHaveBeenCalledWith(
      dependencies.client,
    );
    expect(dependencies.noOpPrinter).toHaveBeenCalledWith(logger);
    expect(dependencies.service).toHaveBeenCalledOnce();
    expect(dependencies.service.mock.calls[0]).toEqual([
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ decide: expect.any(Function) }),
      expect.objectContaining({ report: expect.any(Function) }),
      expect.any(Function),
      expect.any(Object),
    ]);
  });

  it("provides bounded retry advice to the receipt service", async () => {
    createPaymentReceiptService();
    const retryAdvisor = dependencies.service.mock.calls[0]?.[3] as {
      decide(
        request: { attemptNumber: number },
        failure: { retryable: boolean },
      ): Promise<unknown>;
    };

    await expect(
      retryAdvisor.decide({ attemptNumber: 1 }, { retryable: true }),
    ).resolves.toEqual({ action: "RETRY", nextAttemptNumber: 2 });
    await expect(
      retryAdvisor.decide({ attemptNumber: 3 }, { retryable: true }),
    ).resolves.toEqual({ action: "STOP" });
    await expect(
      retryAdvisor.decide({ attemptNumber: 1 }, { retryable: false }),
    ).resolves.toEqual({ action: "STOP" });
  });

  it("sanitizes unexpected composition or dispatch failures", async () => {
    dependencies.dispatch.mockRejectedValue(
      new Error("receipt provider secret"),
    );

    await expect(
      dispatchPaymentReceiptAfterPersistence(actorId, payment as never),
    ).resolves.toBe(failed);
    expect(dependencies.dispatch).toHaveBeenCalledWith(actorId, payment);
    expect(dependencies.preparationFailure).toHaveBeenCalledWith(
      payment.paymentId,
    );
  });
});
