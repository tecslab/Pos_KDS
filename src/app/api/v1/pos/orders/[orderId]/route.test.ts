import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorizeApiPermission: vi.fn(),
  createActiveOrderQueryService: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("../../../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorizeApiPermission,
}));
vi.mock("../../../../../../lib/active-orders/server", () => ({
  createActiveOrderQueryService: dependencies.createActiveOrderQueryService,
}));

import { GET } from "./route";

const orderId = "41000000-0000-4000-8000-000000000001";
const request = new Request(`http://localhost/api/v1/pos/orders/${orderId}`);
const context = (id = orderId) => ({
  params: Promise.resolve({ orderId: id }),
});

beforeEach(() => {
  dependencies.authorizeApiPermission.mockReset().mockResolvedValue({
    ok: true,
    value: { userId: "10000000-0000-4000-8000-000000000001" },
  });
  dependencies.createActiveOrderQueryService.mockReset().mockReturnValue({
    detail: dependencies.detail,
  });
  dependencies.detail.mockReset().mockResolvedValue({
    ok: true,
    value: { id: orderId, status: "PENDING", baskets: [] },
  });
});

describe("GET /api/v1/pos/orders/:orderId", () => {
  it("authorizes orders.view before returning persisted detail", async () => {
    const response = await GET(request, context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: orderId });
    expect(dependencies.authorizeApiPermission).toHaveBeenCalledWith(
      "orders.view",
    );
    expect(dependencies.detail).toHaveBeenCalledWith(orderId);
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", 401],
    ["UNAUTHORIZED", 403],
  ])(
    "returns %s before resolving params or composition",
    async (code, status) => {
      dependencies.authorizeApiPermission.mockResolvedValue({
        ok: false,
        error: { code },
      });
      const params = { then: vi.fn() } as unknown as Promise<{
        orderId: string;
      }>;

      const response = await GET(request, { params });

      expect(response.status).toBe(status);
      expect(params.then).not.toHaveBeenCalled();
      expect(dependencies.createActiveOrderQueryService).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["INVALID_ORDER_ID", 400, "INVALID_ORDER_ID"],
    ["NOT_FOUND", 404, "ORDER_NOT_FOUND"],
    ["OPERATION_FAILED", 500, "INTERNAL_ERROR"],
  ])("maps %s to a safe response", async (failure, status, code) => {
    dependencies.detail.mockResolvedValue({
      ok: false,
      error: { kind: "active-order-query-error", code: failure },
    });

    const response = await GET(request, context());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });
});
