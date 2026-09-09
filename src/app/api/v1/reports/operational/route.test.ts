import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createService: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorize,
}));
vi.mock("../../../../../lib/operational-performance-report/server", () => ({
  createOperationalPerformanceReportService: dependencies.createService,
}));
import { GET } from "./route";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const request = () =>
  new Request(
    `http://localhost/api/v1/reports/operational?restaurantId=${restaurantId}&date=2026-09-06&timeZone=America%2FGuayaquil`,
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

describe("GET /api/v1/reports/operational", () => {
  it("authorizes reports.view before querying persisted operational data", async () => {
    expect((await GET(request())).status).toBe(200);
    expect(dependencies.authorize).toHaveBeenCalledWith("reports.view");
    expect(dependencies.read).toHaveBeenCalledWith({
      actorId,
      restaurantId,
      date: "2026-09-06",
      timeZone: "America/Guayaquil",
    });
  });
  it("rejects duplicate or unsupported query parameters", async () => {
    expect(
      (await GET(new Request(`${request().url}&date=2026-09-07`))).status,
    ).toBe(400);
    expect((await GET(new Request(`${request().url}&export=csv`))).status).toBe(
      400,
    );
  });
  it("does not compose the report after authorization denial", async () => {
    dependencies.authorize.mockResolvedValue({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
    expect((await GET(request())).status).toBe(403);
    expect(dependencies.createService).not.toHaveBeenCalled();
  });
});
