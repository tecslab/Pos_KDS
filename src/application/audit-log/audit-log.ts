import { err, ok, type Result } from "../../domain";
import type { JsonValue } from "../audit";

export const AUDIT_LOG_PAGE_SIZE = 100;

export type AuditLogRecord = Readonly<{
  id: string;
  actorId: string;
  actorName: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string;
  previousValues: JsonValue | null;
  newValues: JsonValue | null;
}>;

export type AuditLogFilters = Readonly<{
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  occurredFrom?: string;
  occurredTo?: string;
}>;

export type AuditLogFilterInput = Readonly<{
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  occurredFrom?: string;
  occurredTo?: string;
}>;

export type AuditLogView = Readonly<{
  records: readonly AuditLogRecord[];
  filters: AuditLogFilters;
}>;

export interface AuditLogReader {
  list(
    filters: AuditLogFilters,
    limit: number,
  ): Promise<readonly AuditLogRecord[]>;
}

export type AuditLogError = Readonly<{
  kind: "audit-log-error";
  code: "INVALID_FILTERS" | "OPERATION_FAILED";
}>;

export class AuditLogService {
  constructor(private readonly reader: AuditLogReader) {}

  async list(
    input: AuditLogFilterInput,
  ): Promise<Result<AuditLogView, AuditLogError>> {
    const filters = parseAuditLogFilters(input);
    if (filters === null) return failure("INVALID_FILTERS");

    try {
      const records = await this.reader.list(filters, AUDIT_LOG_PAGE_SIZE);
      return ok(
        Object.freeze({
          records: Object.freeze([...records]),
          filters,
        }),
      );
    } catch {
      return failure("OPERATION_FAILED");
    }
  }
}

export function parseAuditLogFilters(
  input: AuditLogFilterInput,
): AuditLogFilters | null {
  const actorId = optionalText(input.actorId);
  const entityType = optionalText(input.entityType);
  const entityId = optionalText(input.entityId);
  const action = optionalText(input.action);
  const occurredFromDate = optionalText(input.occurredFrom);
  const occurredToDate = optionalText(input.occurredTo);

  if (
    actorId === null ||
    entityType === null ||
    entityId === null ||
    action === null ||
    occurredFromDate === null ||
    occurredToDate === null ||
    (actorId !== undefined && !isUuid(actorId)) ||
    !withinLimit(entityType, 120) ||
    !withinLimit(entityId, 200) ||
    !withinLimit(action, 120) ||
    !isDateInput(occurredFromDate) ||
    !isDateInput(occurredToDate) ||
    (occurredFromDate !== undefined &&
      occurredToDate !== undefined &&
      occurredFromDate > occurredToDate)
  ) {
    return null;
  }

  return Object.freeze({
    ...(actorId ? { actorId } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(action ? { action } : {}),
    ...(occurredFromDate
      ? { occurredFrom: `${occurredFromDate}T00:00:00.000-05:00` }
      : {}),
    ...(occurredToDate
      ? { occurredTo: `${occurredToDate}T23:59:59.999-05:00` }
      : {}),
  });
}

function optionalText(value: string | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function withinLimit(value: string | undefined, maximum: number) {
  return value === undefined || value.length <= maximum;
}

function isDateInput(value: string | undefined) {
  if (value === undefined) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function failure(code: AuditLogError["code"]) {
  return err(
    Object.freeze({
      kind: "audit-log-error" as const,
      code,
    }),
  );
}
