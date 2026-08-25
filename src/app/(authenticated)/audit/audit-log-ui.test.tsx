import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerPermission: dependencies.authorize,
}));
vi.mock("@/lib/audit-log/server", () => ({
  createAuditLogService: () => ({ list: dependencies.list }),
}));

import AuditPage from "./page";

const actorId = "10000000-0000-4000-8000-000000000001";

describe("audit log UI", () => {
  beforeEach(() => {
    dependencies.authorize.mockReset().mockResolvedValue({ userId: actorId });
    dependencies.list.mockReset().mockResolvedValue({
      ok: true,
      value: { records: [], filters: {} },
    });
  });

  it("authorizes at the page boundary before reading and passes scalar filters", async () => {
    await AuditPage({
      searchParams: Promise.resolve({
        actorId: [actorId, "ignored"],
        entityType: "order",
        occurredFrom: "2026-08-01",
      }),
    });

    expect(dependencies.authorize).toHaveBeenCalledWith(
      "audit.log.view",
      "/audit",
    );
    expect(dependencies.list).toHaveBeenCalledWith({
      actorId,
      entityType: "order",
      entityId: undefined,
      action: undefined,
      occurredFrom: "2026-08-01",
      occurredTo: undefined,
    });
    expect(dependencies.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.list.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("renders actor, time, entity, action, and before/after values", async () => {
    dependencies.list.mockResolvedValue({
      ok: true,
      value: {
        filters: {},
        records: [
          {
            id: "20000000-0000-4000-8000-000000000001",
            actorId,
            actorName: "Ana Torres",
            occurredAt: "2026-08-25T14:30:00.000Z",
            action: "order.cancelled",
            entityType: "order",
            entityId: "ORD-101",
            previousValues: { status: "PENDING" },
            newValues: { status: "CANCELLED" },
          },
        ],
      },
    });

    const markup = renderToStaticMarkup(
      await AuditPage({ searchParams: Promise.resolve({}) }),
    );

    for (const text of [
      "Ana Torres",
      actorId,
      "order.cancelled",
      "ORD-101",
      "PENDING",
      "CANCELLED",
      "Valores anteriores",
      "Valores nuevos",
    ])
      expect(markup).toContain(text);
    expect(markup).toContain('dateTime="2026-08-25T14:30:00.000Z"');
    expect(markup).not.toContain("sourceIp");
  });

  it("provides accessible empty, invalid-filter, and load-failure states", async () => {
    const empty = renderToStaticMarkup(
      await AuditPage({ searchParams: Promise.resolve({}) }),
    );
    expect(empty).toContain('role="status"');
    expect(empty).toContain("No hay eventos de auditoría");

    dependencies.list.mockResolvedValueOnce({
      ok: false,
      error: { kind: "audit-log-error", code: "INVALID_FILTERS" },
    });
    const invalid = renderToStaticMarkup(
      await AuditPage({ searchParams: Promise.resolve({ actorId: "bad" }) }),
    );
    expect(invalid).toContain('role="alert"');
    expect(invalid).toContain("Los filtros no son válidos");

    dependencies.list.mockResolvedValueOnce({
      ok: false,
      error: { kind: "audit-log-error", code: "OPERATION_FAILED" },
    });
    const failed = renderToStaticMarkup(
      await AuditPage({ searchParams: Promise.resolve({}) }),
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("No se pudo cargar el registro");
  });

  it("contains only a GET filter form and no audit mutation boundary", async () => {
    const source = await readFile(
      new URL("./page.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/<form\s+method="get"/);
    expect(source).not.toContain('"use server"');
    expect(source).not.toMatch(/action=\{|\.insert\(|\.update\(|\.delete\(/);
  });
});
