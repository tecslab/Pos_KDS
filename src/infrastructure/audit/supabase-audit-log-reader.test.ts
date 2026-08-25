import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  AuditLogReadError,
  mapAuditLogRow,
  SupabaseAuditLogReader,
} from "./supabase-audit-log-reader";

const actorId = "10000000-0000-4000-8000-000000000001";
const eventId = "20000000-0000-4000-8000-000000000001";

function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: eventId,
    actor_id: actorId,
    occurred_at: "2026-08-25T14:30:00.000Z",
    action: "order.cancelled",
    entity_type: "order",
    entity_id: "ORD-101",
    previous_values: { status: "PENDING" },
    new_values: { status: "CANCELLED" },
    actor: { display_name: "Ana Torres" },
    ...overrides,
  };
}

function fakeClient(result: { data: unknown; error: unknown | null }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.gte.mockReturnValue(query);
  query.lte.mockReturnValue(query);
  query.order.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  return { client: { from } as unknown as SupabaseClient, from, query };
}

describe("SupabaseAuditLogReader", () => {
  it("applies exact filters, deterministic newest-first ordering, and a limit", async () => {
    const fake = fakeClient({ data: [auditRow()], error: null });
    const reader = new SupabaseAuditLogReader(fake.client);

    await expect(
      reader.list(
        {
          actorId,
          entityType: "order",
          entityId: "ORD-101",
          action: "order.cancelled",
          occurredFrom: "2026-08-01T00:00:00.000-05:00",
          occurredTo: "2026-08-25T23:59:59.999-05:00",
        },
        100,
      ),
    ).resolves.toEqual([
      {
        id: eventId,
        actorId,
        actorName: "Ana Torres",
        occurredAt: "2026-08-25T14:30:00.000Z",
        action: "order.cancelled",
        entityType: "order",
        entityId: "ORD-101",
        previousValues: { status: "PENDING" },
        newValues: { status: "CANCELLED" },
      },
    ]);

    expect(fake.from).toHaveBeenCalledWith("audit_events");
    expect(fake.query.select.mock.calls[0]?.[0]).toContain(
      "audit_events_actor_fkey",
    );
    expect(fake.query.eq).toHaveBeenCalledWith("actor_id", actorId);
    expect(fake.query.eq).toHaveBeenCalledWith("entity_type", "order");
    expect(fake.query.eq).toHaveBeenCalledWith("entity_id", "ORD-101");
    expect(fake.query.eq).toHaveBeenCalledWith("action", "order.cancelled");
    expect(fake.query.gte).toHaveBeenCalledWith(
      "occurred_at",
      "2026-08-01T00:00:00.000-05:00",
    );
    expect(fake.query.lte).toHaveBeenCalledWith(
      "occurred_at",
      "2026-08-25T23:59:59.999-05:00",
    );
    expect(fake.query.order).toHaveBeenNthCalledWith(1, "occurred_at", {
      ascending: false,
    });
    expect(fake.query.order).toHaveBeenNthCalledWith(2, "id", {
      ascending: false,
    });
    expect(fake.query.limit).toHaveBeenCalledWith(100);
  });

  it("replaces provider and malformed-data details with a stable error", async () => {
    const failed = fakeClient({
      data: null,
      error: { message: "private provider detail" },
    });
    const malformed = fakeClient({
      data: [auditRow({ actor: null })],
      error: null,
    });

    await expect(
      new SupabaseAuditLogReader(failed.client).list({}, 100),
    ).rejects.toEqual(new AuditLogReadError());
    await expect(
      new SupabaseAuditLogReader(malformed.client).list({}, 100),
    ).rejects.toEqual(new AuditLogReadError());
  });
});

describe("mapAuditLogRow", () => {
  it("accepts the one-row relation array shape", () => {
    expect(
      mapAuditLogRow(auditRow({ actor: [{ display_name: "Ana Torres" }] })),
    ).toMatchObject({ actorName: "Ana Torres" });
  });

  it.each([
    undefined,
    {},
    auditRow({ occurred_at: "not-a-date" }),
    auditRow({ previous_values: undefined }),
    auditRow({ new_values: Number.POSITIVE_INFINITY }),
    auditRow({ actor: [] }),
  ])("fails closed for malformed rows: %o", (row) => {
    expect(() => mapAuditLogRow(row)).toThrow(AuditLogReadError);
  });
});
