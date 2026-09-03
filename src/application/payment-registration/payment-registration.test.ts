import { describe, expect, it, vi } from "vitest";

import { err, ok, type PaymentCompleted, type Result } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { TransactionBoundary } from "../transaction-boundary";
import { TransactionalOperationRunner } from "../transactional-operation-runner";
import {
  PaymentRegistrationService,
  type PaymentRegistrationGateway,
  type RegisteredPayment,
} from "./payment-registration";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const methodId = "43000000-0000-4000-8000-000000000001";
const paymentId = "44000000-0000-4000-8000-000000000001";

const payment: RegisteredPayment = Object.freeze({
  paymentId,
  restaurantId,
  orderId,
  basketId,
  paymentMethodId: methodId,
  recordedById: actorId,
  amount: "5.00",
  paymentMethodCode: "cash",
  paymentMethodName: "Cash",
  referenceNumber: "REF-1",
  comments: "First half",
  recordedAt: "2026-09-02T10:00:00.000Z",
  overageAuthorizedById: null,
  overageAuthorizedAt: null,
  overageReason: null,
  basketTotalAmount: "10.00",
  basketPaidAmount: "5.00",
  basketOutstandingBalance: "5.00",
  basketPreviousStatus: "PENDING",
  basketStatus: "PENDING",
  orderPreviousStatus: "DELIVERED",
  orderStatus: "DELIVERED",
  orderPaidAt: null,
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

function setup(permissions: readonly string[] = ["payments.register"]) {
  const activity: string[] = [];
  const gateway: PaymentRegistrationGateway = {
    register: vi.fn().mockImplementation(async () => {
      activity.push("rpc");
      return ok(payment);
    }),
  };
  const published: PaymentCompleted[] = [];
  const publisher: DomainEventPublisher<PaymentCompleted> = {
    async publish(events) {
      activity.push("publish");
      published.push(...events);
    },
  };
  return {
    activity,
    gateway,
    published,
    service: new PaymentRegistrationService(
      {
        findByAuthenticatedUserId: vi.fn().mockResolvedValue({
          userId: actorId,
          displayName: "Ana",
          isActive: true,
          roleGrants: [
            { roleCode: "custom-cashier", permissionCodes: permissions },
          ],
        }),
      },
      gateway,
      { now: () => new Date("2026-09-02T10:00:00.000Z") },
      new TransactionalOperationRunner(new Boundary(activity), publisher),
    ),
  };
}

describe("PaymentRegistrationService", () => {
  it("normalizes exact money and publishes PaymentCompleted only after commit", async () => {
    const { activity, gateway, published, service } = setup();
    await expect(
      service.register(actorId, {
        basketId,
        paymentMethodId: methodId,
        amount: "5",
        referenceNumber: " REF-1 ",
        comments: " First   half ",
        sourceIp: " 192.0.2.54 ",
      }),
    ).resolves.toEqual(ok(payment));
    expect(gateway.register).toHaveBeenCalledWith({
      actorId,
      basketId,
      paymentMethodId: methodId,
      amount: "5.00",
      referenceNumber: "REF-1",
      comments: "First half",
      overageReason: null,
      sourceIp: "192.0.2.54",
      occurredAt: "2026-09-02T10:00:00.000Z",
    });
    expect(activity).toEqual([
      "transaction:start",
      "rpc",
      "transaction:commit",
      "publish",
    ]);
    expect(published).toEqual([
      {
        type: "payment.completed",
        occurredAt: payment.recordedAt,
        payload: {
          paymentId,
          restaurantId,
          orderId,
          basketId,
          amount: "5.00",
          basketPaidAmount: "5.00",
          basketOutstandingBalance: "5.00",
          basketStatus: "PENDING",
          orderStatus: "DELIVERED",
          recordedAt: payment.recordedAt,
        },
      },
    ]);
    expect(JSON.stringify(published)).not.toMatch(
      /comments|reference|reason|method/i,
    );
  });

  it("fails closed without payments.register", async () => {
    const { gateway, service } = setup([]);
    await expect(
      service.register(actorId, {
        basketId,
        paymentMethodId: methodId,
        amount: "1",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    expect(gateway.register).not.toHaveBeenCalled();
  });

  it("requires overage authorization when a reason requests the exception", async () => {
    const { gateway, service } = setup(["payments.register"]);
    await expect(
      service.register(actorId, {
        basketId,
        paymentMethodId: methodId,
        amount: "11.00",
        overageReason: "Customer gave excess cash",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OVERAGE_NOT_AUTHORIZED" },
    });
    expect(gateway.register).not.toHaveBeenCalled();
  });

  it("allows a permission-bearing actor to self-authorize an overage", async () => {
    const { gateway, service } = setup([
      "payments.register",
      "payments.overage.authorize",
    ]);
    await service.register(actorId, {
      basketId,
      paymentMethodId: methodId,
      amount: "11.00",
      overageReason: "Customer gave excess cash",
    });
    expect(gateway.register).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        overageReason: "Customer gave excess cash",
      }),
    );
  });

  it.each([
    { basketId: "bad", paymentMethodId: methodId, amount: "1.00" },
    { basketId, paymentMethodId: "bad", amount: "1.00" },
    { basketId, paymentMethodId: methodId, amount: "0" },
    { basketId, paymentMethodId: methodId, amount: "1.001" },
    { basketId, paymentMethodId: methodId, amount: "10000000000" },
    {
      basketId,
      paymentMethodId: methodId,
      amount: "1",
      sourceIp: 2 as unknown as string,
    },
  ])("rejects invalid payment input", async (input) => {
    const { gateway, service } = setup();
    await expect(service.register(actorId, input)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_PAYMENT" },
    });
    expect(gateway.register).not.toHaveBeenCalled();
  });

  it("does not publish when the atomic operation rolls back", async () => {
    const { activity, gateway, published, service } = setup();
    vi.mocked(gateway.register).mockResolvedValueOnce(
      err({ kind: "payment-registration-error", code: "ORDER_NOT_DELIVERED" }),
    );
    await service.register(actorId, {
      basketId,
      paymentMethodId: methodId,
      amount: "1",
    });
    expect(activity).toEqual(["transaction:start", "transaction:rollback"]);
    expect(published).toEqual([]);
  });
});
