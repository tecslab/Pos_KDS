import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createService: vi.fn(),
  read: vi.fn(),
}));

vi.mock("../../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorize,
}));
vi.mock("../../../../../lib/daily-sales-report/server", () => ({
  createDailySalesReportService: dependencies.createService,
}));

import { GET } from "./route";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const request = () =>
  new Request(
    `http://localhost/api/v1/reports/daily?restaurantId=${restaurantId}&date=2026-09-06&timeZone=America%2FGuayaquil`,
  );

beforeEach(() => {
  dependencies.authorize.mockReset().mockResolvedValue({
    ok: true,
    value: { userId: actorId },
  });
  dependencies.createService.mockReset().mockReturnValue({
    read: dependencies.read,
  });
  dependencies.read.mockReset().mockResolvedValue({
    ok: true,
    value: { restaurant: { id: restaurantId }, hourlyRevenue: [] },
  });
});

describe("GET /api/v1/reports/daily", () => {
  it("authorizes before reading the persisted restaurant-scoped report", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(dependencies.authorize).toHaveBeenCalledWith("reports.view");
    expect(dependencies.read).toHaveBeenCalledWith({
      actorId,
      restaurantId,
      date: "2026-09-06",
      timeZone: "America/Guayaquil",
    });
    expect(dependencies.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.createService.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", 401],
    ["UNAUTHORIZED", 403],
  ] as const)("denies %s before composing the reader", async (code, status) => {
    dependencies.authorize.mockResolvedValue({ ok: false, error: { code } });

    const response = await GET(request());

    expect(response.status).toBe(status);
    expect(dependencies.createService).not.toHaveBeenCalled();
    expect(dependencies.read).not.toHaveBeenCalled();
  });

  it.each([
    `http://localhost/api/v1/reports/daily?restaurantId=${restaurantId}&date=2026-09-06`,
    `http://localhost/api/v1/reports/daily?restaurantId=${restaurantId}&date=2026-09-06&timeZone=UTC`,
    `http://localhost/api/v1/reports/daily?restaurantId=${restaurantId}&date=2026-09-06&timeZone=America%2FGuayaquil&extra=1`,
    `http://localhost/api/v1/reports/daily?restaurantId=${restaurantId}&restaurantId=${restaurantId}&date=2026-09-06&timeZone=America%2FGuayaquil`,
  ])(
    "rejects incomplete, invalid, unknown, or duplicate parameters",
    async (url) => {
      if (url.includes("timeZone=UTC")) {
        dependencies.read.mockResolvedValue({
          ok: false,
          error: { code: "INVALID_INPUT" },
        });
      }
      const response = await GET(new Request(url));
      expect(response.status).toBe(400);
    },
  );

  it("sanitizes persistence failures", async () => {
    dependencies.read.mockResolvedValue({
      ok: false,
      error: { code: "OPERATION_FAILED", detail: "private sql" },
    });

    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
