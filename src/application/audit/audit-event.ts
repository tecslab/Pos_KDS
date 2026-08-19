export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;

export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

export type RecordAuditEventInput = Readonly<{
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  previousValues?: JsonObject | null;
  newValues?: JsonObject | null;
  sourceIp?: string | null;
}>;

export type AuditEventRecord = Readonly<{
  actorId: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string;
  previousValues: JsonObject | null;
  newValues: JsonObject | null;
  sourceIp: string | null;
}>;

export type InvalidAuditEventError = Readonly<{
  kind: "business-error";
  code: "INVALID_AUDIT_EVENT";
}>;

export function invalidAuditEventError(): InvalidAuditEventError {
  return Object.freeze({
    kind: "business-error",
    code: "INVALID_AUDIT_EVENT",
  });
}
