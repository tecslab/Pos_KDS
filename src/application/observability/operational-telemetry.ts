export type TelemetryErrorClass =
  "AUTHENTICATION" | "DATABASE" | "NETWORK" | "TIMEOUT" | "UNKNOWN";

export type OperationalTelemetryEvent =
  | Readonly<{
      event: "request.completed";
      level: "info" | "error";
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OTHER";
      outcome: "success" | "redirect" | "failure";
      statusCode: number;
      durationMs: number;
    }>
  | Readonly<{
      event: "authentication.failed";
      level: "warning";
      reason: "MISSING_OR_INVALID_SESSION" | "PROVIDER_FAILURE";
    }>
  | Readonly<{
      event: "exception.unexpected";
      level: "error";
      boundary: "request" | "client";
      errorClass: TelemetryErrorClass;
    }>
  | Readonly<{
      event: "database.operation";
      level: "info" | "error";
      operation: "query" | "rpc";
      outcome: "success" | "failure";
      durationMs: number;
      errorClass?: TelemetryErrorClass;
    }>
  | Readonly<{
      event: "realtime.operation";
      level: "info" | "warning";
      operation: "publish" | "subscribe" | "recover";
      outcome: "success" | "failure";
      durationMs: number;
      errorClass?: TelemetryErrorClass;
    }>
  | Readonly<{
      event: "printer.failed";
      level: "warning";
      documentType: "KITCHEN_TICKET" | "PAYMENT_RECEIPT" | "UNKNOWN";
      failureCode:
        | "INVALID_PRINT_REQUEST"
        | "PRINTER_SELECTION_FAILED"
        | "PRINTER_UNAVAILABLE"
        | "PRINT_FAILED"
        | "PRINTER_SERVICE_FAILED";
      retryable: boolean;
      attemptNumber: number;
    }>
  | Readonly<{
      event: "business_event.published";
      level: "info";
      eventType: string;
      count: number;
    }>;

export type OperationalTelemetryRecord = Readonly<
  { schemaVersion: 1 } & OperationalTelemetryEvent
>;

export interface OperationalTelemetrySink {
  write(record: OperationalTelemetryRecord): void | Promise<void>;
}

export interface OperationalTelemetryRecorder {
  record(event: unknown): void;
}

export interface MonotonicClock {
  now(): number;
}

export class NoOpOperationalTelemetryRecorder implements OperationalTelemetryRecorder {
  record(): void {}
}

/**
 * Converts typed telemetry into a closed, metadata-only schema. Invalid or
 * hostile input and sink failures are deliberately ignored.
 */
export class SafeOperationalTelemetryRecorder implements OperationalTelemetryRecorder {
  constructor(private readonly sink: OperationalTelemetrySink) {}

  record(event: unknown): void {
    try {
      const safeRecord = normalizeRecord(event);

      if (safeRecord === null) return;

      const pending = this.sink.write(safeRecord);
      if (isPromiseLike(pending)) {
        void Promise.resolve(pending).catch(() => undefined);
      }
    } catch {
      // Telemetry is best effort and can never alter application outcomes.
    }
  }
}

export function classifyTelemetryError(error: unknown): TelemetryErrorClass {
  try {
    const code = safeUppercase(readProperty(error, "code"));
    const name = safeUppercase(readProperty(error, "name"));

    if (
      code === "ETIMEDOUT" ||
      code === "TIMEOUT" ||
      name === "TIMEOUTERROR" ||
      name === "ABORTERROR"
    ) {
      return "TIMEOUT";
    }
    if (
      code === "PGRST301" ||
      code === "401" ||
      code === "403" ||
      name === "AUTHERROR"
    ) {
      return "AUTHENTICATION";
    }
    if (
      code.startsWith("PGRST") ||
      /^[0-9A-Z]{5}$/.test(code) ||
      name === "POSTGRESTERROR"
    ) {
      return "DATABASE";
    }
    if (
      ["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EAI_AGAIN"].includes(
        code,
      ) ||
      name === "NETWORKERROR"
    ) {
      return "NETWORK";
    }
  } catch {
    // Hostile error objects are classified without reading private content.
  }

  return "UNKNOWN";
}

export function telemetryNow(clock: MonotonicClock): number {
  try {
    const value = clock.now();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function telemetryDuration(clock: MonotonicClock, startedAt: number) {
  const elapsed = telemetryNow(clock) - startedAt;
  return Number.isFinite(elapsed) && elapsed > 0
    ? Math.round(elapsed * 1000) / 1000
    : 0;
}

function normalizeRecord(event: unknown): OperationalTelemetryRecord | null {
  if (!isRecord(event) || typeof event.event !== "string") return null;

  switch (event.event) {
    case "request.completed": {
      const method = normalizeMethod(event.method);
      const outcome = oneOf(event.outcome, ["success", "redirect", "failure"]);
      const statusCode = safeInteger(event.statusCode, 100, 599);
      const durationMs = duration(event.durationMs);
      if (
        method === null ||
        outcome === null ||
        statusCode === null ||
        durationMs === null
      )
        return null;
      return freezeRecord({
        event: "request.completed",
        level: outcome === "failure" ? "error" : "info",
        method,
        outcome,
        statusCode,
        durationMs,
      });
    }
    case "authentication.failed": {
      const reason = oneOf(event.reason, [
        "MISSING_OR_INVALID_SESSION",
        "PROVIDER_FAILURE",
      ]);
      return reason === null
        ? null
        : freezeRecord({
            event: "authentication.failed",
            level: "warning",
            reason,
          });
    }
    case "exception.unexpected": {
      const boundary = oneOf(event.boundary, ["request", "client"]);
      const errorClass = normalizeErrorClass(event.errorClass);
      return boundary === null || errorClass === null
        ? null
        : freezeRecord({
            event: "exception.unexpected",
            level: "error",
            boundary,
            errorClass,
          });
    }
    case "database.operation":
      return normalizeOperationRecord(
        event,
        "database.operation",
        ["query", "rpc"],
        "error",
      );
    case "realtime.operation":
      return normalizeOperationRecord(
        event,
        "realtime.operation",
        ["publish", "subscribe", "recover"],
        "warning",
      );
    case "printer.failed": {
      const documentType = oneOf(event.documentType, [
        "KITCHEN_TICKET",
        "PAYMENT_RECEIPT",
        "UNKNOWN",
      ]);
      const failureCode = oneOf(event.failureCode, [
        "INVALID_PRINT_REQUEST",
        "PRINTER_SELECTION_FAILED",
        "PRINTER_UNAVAILABLE",
        "PRINT_FAILED",
        "PRINTER_SERVICE_FAILED",
      ]);
      const attemptNumber = safeInteger(event.attemptNumber, 0, 1_000_000);
      if (
        documentType === null ||
        failureCode === null ||
        typeof event.retryable !== "boolean" ||
        attemptNumber === null
      )
        return null;
      return freezeRecord({
        event: "printer.failed",
        level: "warning",
        documentType,
        failureCode,
        retryable: event.retryable,
        attemptNumber,
      });
    }
    case "business_event.published": {
      const eventType =
        typeof event.eventType === "string" &&
        /^[a-z][a-z0-9.-]{0,63}$/.test(event.eventType)
          ? event.eventType
          : null;
      const count = safeInteger(event.count, 1, 1_000_000);
      return eventType === null || count === null
        ? null
        : freezeRecord({
            event: "business_event.published",
            level: "info",
            eventType,
            count,
          });
    }
    default:
      return null;
  }
}

function normalizeOperationRecord<
  Event extends "database.operation" | "realtime.operation",
  Operation extends string,
>(
  input: Record<string, unknown>,
  event: Event,
  operations: readonly Operation[],
  failureLevel: "error" | "warning",
): OperationalTelemetryRecord | null {
  const operation = oneOf(input.operation, operations);
  const outcome = oneOf(input.outcome, ["success", "failure"]);
  const durationMs = duration(input.durationMs);
  const errorClass = normalizeErrorClass(input.errorClass);
  if (
    operation === null ||
    outcome === null ||
    durationMs === null ||
    (outcome === "failure" && errorClass === null)
  )
    return null;

  const base = {
    event,
    level: outcome === "failure" ? failureLevel : "info",
    operation,
    outcome,
    durationMs,
  };
  return Object.freeze({
    schemaVersion: 1,
    ...base,
    ...(outcome === "failure" ? { errorClass } : {}),
  }) as OperationalTelemetryRecord;
}

function freezeRecord<Event extends OperationalTelemetryEvent>(
  event: Event,
): OperationalTelemetryRecord {
  return Object.freeze({
    schemaVersion: 1 as const,
    ...event,
  }) as OperationalTelemetryRecord;
}

function normalizeMethod(value: unknown) {
  return oneOf(value, ["GET", "POST", "PUT", "PATCH", "DELETE"]) ?? "OTHER";
}

function normalizeErrorClass(value: unknown) {
  return oneOf(value, [
    "AUTHENTICATION",
    "DATABASE",
    "NETWORK",
    "TIMEOUT",
    "UNKNOWN",
  ]);
}

function duration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1000) / 1000
    : null;
}

function safeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
    ? (value as number)
    : null;
}

function oneOf<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): Value | null {
  return typeof value === "string" && allowed.includes(value as Value)
    ? (value as Value)
    : null;
}

function safeUppercase(value: unknown): string {
  return typeof value === "string" && value.length <= 64
    ? value.toUpperCase()
    : "";
}

function readProperty(value: unknown, property: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[property]
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return (
    ((typeof value === "object" && value !== null) ||
      typeof value === "function") &&
    typeof (value as PromiseLike<void>).then === "function"
  );
}
