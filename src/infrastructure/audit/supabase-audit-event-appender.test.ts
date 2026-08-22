import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { AuditEventRecord } from "../../application";
import { SupabaseAuditEventAppender } from "./supabase-audit-event-appender";

const event: AuditEventRecord = Object.freeze({
  actorId: "10000000-0000-4000-8000-000000000001",
  occurredAt: "2026-08-22T15:00:00.000Z",
  action: "user.deactivated",
  entityType: "application_user",
  entityId: "20000000-0000-4000-8000-000000000002",
  previousValues: Object.freeze({ isActive: true }),
  newValues: Object.freeze({ isActive: false }),
  sourceIp: null,
});

function setup(error: unknown = null) {
  const insert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue({ insert });
  const client = { from } as unknown as SupabaseClient;
  return { appender: new SupabaseAuditEventAppender(client), from, insert };
}

describe("SupabaseAuditEventAppender", () => {
  it("maps the immutable application event to the append-only schema", async () => {
    const { appender, from, insert } = setup();

    await appender.append(event);

    expect(from).toHaveBeenCalledWith("audit_events");
    expect(insert).toHaveBeenCalledWith({
      actor_id: event.actorId,
      occurred_at: event.occurredAt,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId,
      previous_values: event.previousValues,
      new_values: event.newValues,
      source_ip: event.sourceIp,
    });
  });

  it("does not leak provider details when persistence fails", async () => {
    const { appender } = setup({ message: "credential and provider details" });

    await expect(appender.append(event)).rejects.toThrow(
      "Audit persistence failed.",
    );
  });
});
