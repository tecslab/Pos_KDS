import { describe, expect, it, vi } from "vitest";

import type { AuditLogReader } from "./audit-log";
import {
  AUDIT_LOG_PAGE_SIZE,
  AuditLogService,
  parseAuditLogFilters,
} from "./audit-log";

const actorId = "10000000-0000-4000-8000-000000000001";

describe("parseAuditLogFilters", () => {
  it("normalizes exact filters and expands dates to restaurant-local day bounds", () => {
    expect(
      parseAuditLogFilters({
        actorId: ` ${actorId} `,
        entityType: " order ",
        entityId: " 4001 ",
        action: " order.cancelled ",
        occurredFrom: "2026-08-01",
        occurredTo: "2026-08-25",
      }),
    ).toEqual({
      actorId,
      entityType: "order",
      entityId: "4001",
      action: "order.cancelled",
      occurredFrom: "2026-08-01T00:00:00.000-05:00",
      occurredTo: "2026-08-25T23:59:59.999-05:00",
    });
  });

  it.each([
    { actorId: "not-a-uuid" },
    { entityType: "x".repeat(121) },
    { entityId: "x".repeat(201) },
    { action: "x".repeat(121) },
    { occurredFrom: "2026-02-30" },
    { occurredFrom: "2026-08-26", occurredTo: "2026-08-25" },
  ])("rejects unsafe or impossible filter input: %o", (input) => {
    expect(parseAuditLogFilters(input)).toBeNull();
  });
});

describe("AuditLogService", () => {
  it("performs a bounded read with parsed filters", async () => {
    const reader: AuditLogReader = { list: vi.fn().mockResolvedValue([]) };
    const result = await new AuditLogService(reader).list({
      entityType: "inventory_item",
    });

    expect(result).toMatchObject({ ok: true });
    expect(reader.list).toHaveBeenCalledWith(
      { entityType: "inventory_item" },
      AUDIT_LOG_PAGE_SIZE,
    );
  });

  it("does not query for invalid filters and hides persistence failures", async () => {
    const reader: AuditLogReader = {
      list: vi.fn().mockRejectedValue(new Error("private database detail")),
    };
    const invalid = await new AuditLogService(reader).list({
      actorId: "bad",
    });
    expect(invalid).toEqual({
      ok: false,
      error: { kind: "audit-log-error", code: "INVALID_FILTERS" },
    });
    expect(reader.list).not.toHaveBeenCalled();

    const failed = await new AuditLogService(reader).list({});
    expect(failed).toEqual({
      ok: false,
      error: { kind: "audit-log-error", code: "OPERATION_FAILED" },
    });
  });
});
