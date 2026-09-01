import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createService: vi.fn(),
  markReady: vi.fn(),
}));

vi.mock("../../../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorize,
}));
vi.mock("../../../../../../lib/order-ready/server", () => ({
  createOrderReadyService: dependencies.createService,
}));

import { PATCH } from "./route";

const actorId = "10000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const context = (id = orderId) => ({
  params: Promise.resolve({ orderId: id }),
});

beforeEach(() => {
  dependencies.authorize.mockReset().mockResolvedValue({
    ok: true,
    value: { userId: actorId },
  });
  dependencies.createService.mockReset().mockReturnValue({
    markReady: dependencies.markReady,
  });
  dependencies.markReady.mockReset().mockResolvedValue({
    ok: true,
    value: {
      orderId,
      status: "READY",
      readyAt: "2026-09-01T10:00:00.000Z",
      totalAmount: "12.00",
      outstandingBalance: "8.00",
      paymentStatus: "PARTIALLY_PAID",
      unitPrice: "6.00",
    },
  });
});

describe("PATCH /api/v1/kitchen/orders/:orderId", () => {
  it("marks Ready once for the authenticated actor with path-owned input", async () => {
    const response = await PATCH(new Request("http://localhost"), context());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      orderId,
      status: "READY",
      readyAt: "2026-09-01T10:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toMatch(
      /total|price|balance|payment|amount/i,
    );
    expect(dependencies.authorize).toHaveBeenCalledWith("kitchen.ready.mark");
    expect(dependencies.markReady).toHaveBeenCalledWith(actorId, {
      orderId,
      sourceIp: null,
    });
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", 401, "Authentication is required."],
    ["UNAUTHORIZED", 403, "You are not authorized to perform this operation."],
  ] as const)(
    "returns %s before resolving params or composition",
    async (code, status, message) => {
      dependencies.authorize.mockResolvedValue({ ok: false, error: { code } });
      const params = { then: vi.fn() } as unknown as Promise<{
        orderId: string;
      }>;
      const response = await PATCH(new Request("http://localhost"), { params });
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: { code, message },
      });
      expect(params.then).not.toHaveBeenCalled();
      expect(dependencies.createService).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["INVALID_READY_TRANSITION", 422],
    ["NOT_FOUND", 404],
    ["ORDER_NOT_PENDING", 409],
  ] as const)("maps %s to %s", async (code, status) => {
    dependencies.markReady.mockResolvedValue({
      ok: false,
      error: { kind: "order-ready-error", code },
    });
    const response = await PATCH(new Request("http://localhost"), context());
    expect(response.status).toBe(status);
  });

  it("sanitizes operation, composition, and publication failures", async () => {
    dependencies.markReady.mockRejectedValue(
      new Error("private provider detail"),
    );
    const response = await PATCH(new Request("http://localhost"), context());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  });
});
