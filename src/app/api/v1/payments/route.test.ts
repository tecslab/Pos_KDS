import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createService: vi.fn(),
  dispatchReceipt: vi.fn(),
  register: vi.fn(),
}));

vi.mock("../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorize,
}));
vi.mock("../../../../lib/payment-registration/server", () => ({
  createPaymentRegistrationService: dependencies.createService,
}));
vi.mock("../../../../lib/payment-receipts/server", () => ({
  dispatchPaymentReceiptAfterPersistence: dependencies.dispatchReceipt,
}));

import { POST } from "./route";

const actorId = "10000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const paymentMethodId = "32000000-0000-4000-8000-000000000001";
const registered = Object.freeze({
  paymentId: "44000000-0000-4000-8000-000000000001",
  basketId,
  amount: "5.00",
  recordedById: actorId,
  recordedAt: "2026-09-03T10:00:00.000Z",
});
const receipt = Object.freeze({
  status: "skipped",
  jobId: `payment-receipt:${registered.paymentId}`,
  attemptId: "attempt-1",
  reason: "ADAPTER_NOOP",
});

function request(value: unknown) {
  return new Request("http://localhost/api/v1/payments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

beforeEach(() => {
  dependencies.authorize.mockReset().mockResolvedValue({
    ok: true,
    value: { userId: actorId },
  });
  dependencies.createService.mockReset().mockReturnValue({
    register: dependencies.register,
  });
  dependencies.register.mockReset().mockResolvedValue({
    ok: true,
    value: registered,
  });
  dependencies.dispatchReceipt.mockReset().mockResolvedValue(receipt);
});

describe("POST /api/v1/payments", () => {
  it("registers for the authenticated actor using only the public payment input", async () => {
    const response = await POST(
      request({
        basketId,
        paymentMethodId,
        amount: "5.00",
        referenceNumber: "REF-1",
        comments: "Partial payment",
        overageReason: null,
        actorId: "client-actor",
        recordedById: "client-recorder",
        recordedAt: "2000-01-01T00:00:00Z",
        sourceIp: "client-ip",
        status: "PAID",
        totalAmount: "0.01",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      payment: registered,
      receipt,
    });
    expect(dependencies.authorize).toHaveBeenCalledWith("payments.register");
    expect(dependencies.register).toHaveBeenCalledWith(actorId, {
      basketId,
      paymentMethodId,
      amount: "5.00",
      referenceNumber: "REF-1",
      comments: "Partial payment",
      overageReason: null,
      sourceIp: null,
    });
    expect(dependencies.dispatchReceipt).toHaveBeenCalledWith(
      actorId,
      registered,
    );
    expect(dependencies.register.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.dispatchReceipt.mock.invocationCallOrder[0] as number,
    );
  });

  it("keeps a committed payment successful when receipt dispatch reports failure", async () => {
    dependencies.dispatchReceipt.mockResolvedValue({
      status: "failed",
      jobId: `payment-receipt:${registered.paymentId}`,
      attemptId: "attempt-1",
      failure: { code: "PRINTER_UNAVAILABLE", retryable: true },
      retry: { action: "RETRY", nextAttemptNumber: 2 },
    });

    const response = await POST(
      request({ basketId, paymentMethodId, amount: "5.00" }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      payment: registered,
      receipt: {
        status: "failed",
        failure: { code: "PRINTER_UNAVAILABLE", retryable: true },
        retry: { action: "RETRY", nextAttemptNumber: 2 },
      },
    });
  });

  it("keeps a committed payment successful when receipt composition unexpectedly rejects", async () => {
    dependencies.dispatchReceipt.mockRejectedValue(
      new Error("receipt composition secret"),
    );

    const response = await POST(
      request({ basketId, paymentMethodId, amount: "5.00" }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      payment: registered,
      receipt: {
        status: "failed",
        jobId: `payment-receipt:${registered.paymentId}`,
        attemptId: null,
        failure: { code: "RECEIPT_PREPARATION_FAILED", retryable: false },
        retry: { action: "STOP" },
      },
    });
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", 401],
    ["UNAUTHORIZED", 403],
  ] as const)(
    "returns %s before parsing or composition",
    async (code, status) => {
      dependencies.authorize.mockResolvedValue({ ok: false, error: { code } });
      const json = vi.fn();

      const response = await POST({ json } as unknown as Request);

      expect(response.status).toBe(status);
      expect(json).not.toHaveBeenCalled();
      expect(dependencies.createService).not.toHaveBeenCalled();
      expect(dependencies.dispatchReceipt).not.toHaveBeenCalled();
    },
  );

  it("returns typed invalid JSON and domain validation errors", async () => {
    const invalidJson = await POST({
      json: vi.fn().mockRejectedValue(new SyntaxError("private")),
    } as unknown as Request);
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(dependencies.createService).not.toHaveBeenCalled();
    expect(dependencies.dispatchReceipt).not.toHaveBeenCalled();

    dependencies.register.mockResolvedValue({
      ok: false,
      error: { kind: "payment-registration-error", code: "INVALID_PAYMENT" },
    });
    const invalidPayment = await POST(request({ amount: "bad" }));
    expect(invalidPayment.status).toBe(422);
    await expect(invalidPayment.json()).resolves.toMatchObject({
      error: { code: "INVALID_PAYMENT" },
    });
    expect(dependencies.dispatchReceipt).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_FOUND", 404],
    ["ORDER_NOT_DELIVERED", 409],
    ["BASKET_ALREADY_PAID", 409],
    ["PAYMENT_METHOD_UNAVAILABLE", 409],
    ["OVERAGE_NOT_AUTHORIZED", 403],
    ["OVERAGE_REASON_REQUIRED", 422],
  ] as const)("maps %s to status %s", async (code, status) => {
    dependencies.register.mockResolvedValue({
      ok: false,
      error: { kind: "payment-registration-error", code },
    });

    const response = await POST(
      request({ basketId, paymentMethodId, amount: "5.00" }),
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it("sanitizes malformed service failures and publication rejection", async () => {
    dependencies.register.mockResolvedValue({
      ok: false,
      error: {
        kind: "payment-registration-error",
        code: "INVALID_PAYMENT",
        detail: "private",
      },
    });
    const malformed = await POST(request({}));
    expect(malformed.status).toBe(500);
    expect(JSON.stringify(await malformed.json())).not.toContain("private");

    dependencies.register.mockRejectedValue(new Error("realtime secret"));
    const rejected = await POST(request({}));
    expect(rejected.status).toBe(500);
    expect(JSON.stringify(await rejected.json())).not.toContain("secret");
  });
});
