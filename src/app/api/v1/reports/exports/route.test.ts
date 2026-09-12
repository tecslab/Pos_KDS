import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createService: vi.fn(),
  exportReport: vi.fn(),
}));

vi.mock("../../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorize,
}));
vi.mock("../../../../../lib/report-export/server", () => ({
  createReportExportService: dependencies.createService,
}));

import { POST } from "./route";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";

function request(body: unknown = validBody()) {
  return new Request("http://localhost/api/v1/reports/exports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    restaurantId,
    date: "2026-09-10",
    timeZone: "America/Guayaquil",
    format: "pdf",
  };
}

beforeEach(() => {
  dependencies.authorize.mockReset().mockResolvedValue({
    ok: true,
    value: { userId: actorId },
  });
  dependencies.exportReport.mockReset().mockResolvedValue({
    ok: true,
    value: {
      bytes: new Uint8Array([37, 80, 68, 70]),
      contentType: "application/pdf",
      extension: "pdf",
      filename: "reporte-2026-09-10.pdf",
    },
  });
  dependencies.createService.mockReset().mockReturnValue({
    export: dependencies.exportReport,
  });
});

describe("POST /api/v1/reports/exports", () => {
  it("requires view and export permission before reading the body or composing", async () => {
    dependencies.authorize.mockResolvedValueOnce({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
    const json = vi.fn();
    const response = await POST({ json } as unknown as Request);

    expect(response.status).toBe(403);
    expect(dependencies.authorize).toHaveBeenCalledTimes(1);
    expect(dependencies.authorize).toHaveBeenCalledWith("reports.view");
    expect(json).not.toHaveBeenCalled();
    expect(dependencies.createService).not.toHaveBeenCalled();
  });

  it("denies a user without reports.export before service composition", async () => {
    dependencies.authorize
      .mockResolvedValueOnce({ ok: true, value: { userId: actorId } })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "UNAUTHORIZED" },
      });
    const json = vi.fn();

    expect((await POST({ json } as unknown as Request)).status).toBe(403);
    expect(dependencies.authorize).toHaveBeenNthCalledWith(2, "reports.export");
    expect(json).not.toHaveBeenCalled();
    expect(dependencies.createService).not.toHaveBeenCalled();
  });

  it("rejects mismatched authorization actors before reading the body", async () => {
    dependencies.authorize
      .mockResolvedValueOnce({ ok: true, value: { userId: actorId } })
      .mockResolvedValueOnce({
        ok: true,
        value: { userId: "10000000-0000-4000-8000-000000000002" },
      });
    const json = vi.fn();

    const response = await POST({ json } as unknown as Request);

    expect(response.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(dependencies.createService).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "You are not authorized to perform this operation.",
      },
    });
  });

  it("passes filters only with the verified actor and returns hardened attachment headers", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(dependencies.exportReport).toHaveBeenCalledWith({
      actorId,
      ...validBody(),
    });
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="reporte-2026-09-10.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rejects malformed, missing, and extra request properties", async () => {
    expect(
      (await POST(new Request(request().url, { method: "POST", body: "{" })))
        .status,
    ).toBe(400);
    expect(
      (await POST(request({ ...validBody(), format: undefined }))).status,
    ).toBe(400);
    expect(
      (await POST(request({ ...validBody(), report: { total: "private" } })))
        .status,
    ).toBe(400);
  });

  it("maps service failures without exposing details", async () => {
    dependencies.exportReport.mockResolvedValue({
      ok: false,
      error: { code: "OPERATION_FAILED", detail: "private report row" },
    });
    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private report row");
  });
});
