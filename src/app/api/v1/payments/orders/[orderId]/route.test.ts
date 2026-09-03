import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createService: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("../../../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorize,
}));
vi.mock("../../../../../../lib/payment-queries/server", () => ({
  createPaymentQueryService: dependencies.createService,
}));

import { GET } from "./route";

const orderId = "41000000-0000-4000-8000-000000000001";
const context = (id = orderId) => ({
  params: Promise.resolve({ orderId: id }),
});

beforeEach(() => {
  dependencies.authorize.mockReset().mockResolvedValue({
    ok: true,
    value: { userId: "10000000-0000-4000-8000-000000000001" },
  });
  dependencies.createService.mockReset().mockReturnValue({
    detail: dependencies.detail,
  });
  dependencies.detail.mockReset().mockResolvedValue({
    ok: true,
    value: { id: orderId, status: "DELIVERED", baskets: [] },
  });
});

describe("GET /api/v1/payments/orders/:orderId", () => {
  it("authorizes payment history independently from general order access", async () => {
    const response = await GET(new Request("http://localhost"), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      order: { id: orderId, status: "DELIVERED", baskets: [] },
    });
    expect(dependencies.authorize).toHaveBeenCalledWith("payments.view");
    expect(dependencies.detail).toHaveBeenCalledWith(orderId);
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", 401],
    ["UNAUTHORIZED", 403],
  ] as const)("returns %s before resolving params", async (code, status) => {
    dependencies.authorize.mockResolvedValue({ ok: false, error: { code } });
    const params = { then: vi.fn() } as unknown as Promise<{ orderId: string }>;

    const response = await GET(new Request("http://localhost"), { params });

    expect(response.status).toBe(status);
    expect(params.then).not.toHaveBeenCalled();
    expect(dependencies.createService).not.toHaveBeenCalled();
  });

  it.each([
    ["INVALID_ORDER_ID", 400, "INVALID_ORDER_ID"],
    ["NOT_FOUND", 404, "ORDER_NOT_FOUND"],
  ] as const)(
    "maps %s to a sanitized response",
    async (code, status, publicCode) => {
      dependencies.detail.mockResolvedValue({
        ok: false,
        error: { kind: "payment-query-error", code },
      });

      const response = await GET(new Request("http://localhost"), context());

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: publicCode },
      });
    },
  );

  it("sanitizes persistence failures", async () => {
    dependencies.detail.mockRejectedValue(new Error("private provider detail"));

    const response = await GET(new Request("http://localhost"), context());

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
