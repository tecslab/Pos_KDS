import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ authorize: vi.fn(), list: vi.fn() }));

vi.mock("../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorize,
}));
vi.mock("../../../../lib/inventory-views/server", () => ({
  createInventoryViewsService: () => ({ list: dependencies.list }),
}));

import { GET } from "./route";

beforeEach(() => {
  dependencies.authorize.mockReset().mockResolvedValue({ ok: true, value: {} });
  dependencies.list.mockReset().mockResolvedValue({
    ok: true,
    value: { balances: [], movements: [], activeAlerts: [] },
  });
});

describe("GET /api/v1/inventory", () => {
  it("uses the inventory.view permission and exposes only the persisted projection", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      balances: [],
      movements: [],
      activeAlerts: [],
    });
    expect(dependencies.authorize).toHaveBeenCalledWith("inventory.view");
    expect(dependencies.list).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", 401, "Authentication is required."],
    ["UNAUTHORIZED", 403, "You are not authorized to perform this operation."],
  ] as const)(
    "denies %s before composing the query service",
    async (code, status, message) => {
      dependencies.authorize.mockResolvedValue({ ok: false, error: { code } });

      const response = await GET();

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: { code, message },
      });
      expect(dependencies.list).not.toHaveBeenCalled();
    },
  );

  it("sanitizes projection failures", async () => {
    dependencies.list.mockResolvedValue({
      ok: false,
      error: { code: "OPERATION_FAILED", detail: "private database detail" },
    });

    const response = await GET();

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
