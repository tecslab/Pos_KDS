import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuditEventAppender, AuditEventRecord } from "../../application";

export class SupabaseAuditEventAppender implements AuditEventAppender {
  constructor(private readonly client: SupabaseClient) {}

  async append(event: AuditEventRecord): Promise<void> {
    const { error } = await this.client.from("audit_events").insert({
      actor_id: event.actorId,
      occurred_at: event.occurredAt,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId,
      previous_values: event.previousValues,
      new_values: event.newValues,
      source_ip: event.sourceIp,
    });
    if (error !== null) throw new Error("Audit persistence failed.");
  }
}
