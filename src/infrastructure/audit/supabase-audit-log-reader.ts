import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuditLogFilters,
  AuditLogReader,
  AuditLogRecord,
  JsonValue,
} from "../../application";

const AUDIT_LOG_QUERY = `
  id,
  actor_id,
  occurred_at,
  action,
  entity_type,
  entity_id,
  previous_values,
  new_values,
  actor:application_users!audit_events_actor_fkey (display_name)
`;

export class AuditLogReadError extends Error {
  constructor() {
    super("The audit log could not be read.");
    this.name = "AuditLogReadError";
  }
}

export class SupabaseAuditLogReader implements AuditLogReader {
  constructor(private readonly client: SupabaseClient) {}

  async list(
    filters: AuditLogFilters,
    limit: number,
  ): Promise<readonly AuditLogRecord[]> {
    try {
      let query = this.client.from("audit_events").select(AUDIT_LOG_QUERY);

      if (filters.actorId) query = query.eq("actor_id", filters.actorId);
      if (filters.entityType)
        query = query.eq("entity_type", filters.entityType);
      if (filters.entityId) query = query.eq("entity_id", filters.entityId);
      if (filters.action) query = query.eq("action", filters.action);
      if (filters.occurredFrom)
        query = query.gte("occurred_at", filters.occurredFrom);
      if (filters.occurredTo)
        query = query.lte("occurred_at", filters.occurredTo);

      const { data, error } = await query
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);

      if (error !== null || !Array.isArray(data)) throw new Error();
      return Object.freeze(data.map(mapAuditLogRow));
    } catch {
      throw new AuditLogReadError();
    }
  }
}

export function mapAuditLogRow(value: unknown): AuditLogRecord {
  if (!isRecord(value)) throw new AuditLogReadError();
  const actor = singleRelation(value.actor);
  if (
    typeof value.id !== "string" ||
    typeof value.actor_id !== "string" ||
    typeof value.occurred_at !== "string" ||
    !isIsoTimestamp(value.occurred_at) ||
    typeof value.action !== "string" ||
    typeof value.entity_type !== "string" ||
    typeof value.entity_id !== "string" ||
    !actor ||
    typeof actor.display_name !== "string" ||
    !isJsonValueOrNull(value.previous_values) ||
    !isJsonValueOrNull(value.new_values)
  ) {
    throw new AuditLogReadError();
  }

  return Object.freeze({
    id: value.id,
    actorId: value.actor_id,
    actorName: actor.display_name,
    occurredAt: value.occurred_at,
    action: value.action,
    entityType: value.entity_type,
    entityId: value.entity_id,
    previousValues: value.previous_values,
    newValues: value.new_values,
  });
}

function singleRelation(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0]))
    return value[0];
  return null;
}

function isIsoTimestamp(value: string) {
  return Number.isFinite(Date.parse(value));
}

function isJsonValueOrNull(value: unknown): value is JsonValue | null {
  if (value === null || ["string", "boolean"].includes(typeof value))
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValueOrNull);
  if (isRecord(value)) return Object.values(value).every(isJsonValueOrNull);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
