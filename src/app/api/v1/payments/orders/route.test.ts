import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createService: vi.fn(),
  list: vi.fn(),
}));

vi.mock("../../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorize,
}));
vi.mock("../../../../../lib/payment-queries/server", () => ({
  createPaymentQueryService: dependencies.createService,
}));

import { GET } from "./route";

const locationId = "31000000-0000-4000-8000-000000000001";

beforeEach(() => {
  dependencies.authorize.mockReset().mockResolvedValue({
    ok: true,
    value: { userId: "10000000-0000-4000-8000-000000000001" },
  });
  dependencies.createService.mockReset().mockReturnValue({
    list: dependencies.list,
  });
  dependencies.list.mockReset().mockResolvedValue({ ok: true, value: [] });
});

function request(search = "") {
  return new Request(`http://localhost/api/v1/payments/orders${search}`);
}

describe("GET /api/v1/payments/orders", () => {
  it("uses payments.view and returns every authorized unpaid projection", async () => {
    const orders = [{ id: "41000000-0000-4000-8000-000000000001" }];
    dependencies.list.mockResolvedValue({ ok: true, value: orders });

    const response = await GET(
      request(`?serviceLocationId=${locationId}&orderNumber=%20ORD-42%20`),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ orders });
    expect(dependencies.authorize).toHaveBeenCalledWith("payments.view");
    expect(dependencies.list).toHaveBeenCalledWith({
      serviceLocationId: locationId,
      orderNumber: " ORD-42 ",
    });
  });

  it.each([
    "?status=PAID",
    "?orderNumber=ORD-1&orderNumber=ORD-2",
    `?serviceLocationId=${locationId}&unknown=private`,
  ])("rejects unsupported or repeated filters: %s", async (search) => {
    const response = await GET(request(search));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_FILTERS",
        message: "The pending-payment filters are invalid.",
      },
    });
    expect(dependencies.createService).not.toHaveBeenCalled();
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", 401, "Authentication is required."],
    ["UNAUTHORIZED", 403, "You are not authorized to perform this operation."],
  ] as const)(
    "returns %s before parsing or privileged composition",
    async (code, status, message) => {
      dependencies.authorize.mockResolvedValue({ ok: false, error: { code } });

      const response = await GET(request("?unknown=value"));

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: { code, message },
      });
      expect(dependencies.createService).not.toHaveBeenCalled();
      expect(dependencies.list).not.toHaveBeenCalled();
    },
  );

  it("sanitizes application and composition failures", async () => {
    dependencies.list.mockResolvedValue({
      ok: false,
      error: { code: "OPERATION_FAILED", detail: "private" },
    });
    const applicationFailure = await GET(request());
    expect(applicationFailure.status).toBe(500);
    expect(JSON.stringify(await applicationFailure.json())).not.toContain(
      "private",
    );

    dependencies.createService.mockImplementation(() => {
      throw new Error("database password: private");
    });
    const compositionFailure = await GET(request());
    expect(compositionFailure.status).toBe(500);
    expect(JSON.stringify(await compositionFailure.json())).not.toContain(
      "private",
    );
  });
});
