import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createService: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorize,
}));
vi.mock(
  "../../../../../lib/inventory-production-expense-report/server",
  () => ({
    createInventoryProductionExpenseReportService: dependencies.createService,
  }),
);
import { GET } from "./route";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const request = () =>
  new Request(
    `http://localhost/api/v1/reports/inventory-production-expenses?restaurantId=${restaurantId}&date=2026-09-06&timeZone=America%2FGuayaquil`,
  );

beforeEach(() => {
  dependencies.authorize
    .mockReset()
    .mockResolvedValue({ ok: true, value: { userId: actorId } });
  dependencies.createService
    .mockReset()
    .mockReturnValue({ read: dependencies.read });
  dependencies.read.mockReset().mockResolvedValue({ ok: true, value: {} });
});

describe("GET /api/v1/reports/inventory-production-expenses", () => {
  it("authorizes reports.view before reading persisted data", async () => {
    expect((await GET(request())).status).toBe(200);
    expect(dependencies.authorize).toHaveBeenCalledWith("reports.view");
    expect(dependencies.read).toHaveBeenCalledWith({
      actorId,
      restaurantId,
      date: "2026-09-06",
      timeZone: "America/Guayaquil",
    });
  });

  it("rejects missing, duplicate, and export parameters", async () => {
    expect(
      (await GET(new Request(`${request().url}&date=2026-09-07`))).status,
    ).toBe(400);
    expect((await GET(new Request(`${request().url}&export=csv`))).status).toBe(
      400,
    );
    expect(
      (
        await GET(
          new Request(
            `http://localhost/api/v1/reports/inventory-production-expenses?restaurantId=${restaurantId}&date=2026-09-06`,
          ),
        )
      ).status,
    ).toBe(400);
  });

  it("does not compose the service after permission denial", async () => {
    dependencies.authorize.mockResolvedValue({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
    expect((await GET(request())).status).toBe(403);
    expect(dependencies.createService).not.toHaveBeenCalled();
  });

  it("returns safe failures from the persistence boundary", async () => {
    dependencies.read.mockResolvedValue({
      ok: false,
      error: { code: "UNAUTHORIZED", detail: "private" },
    });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private");
  });
});
