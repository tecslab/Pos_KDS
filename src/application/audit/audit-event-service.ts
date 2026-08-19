import { err, ok, type Result } from "../../domain";

import type { AuditClock } from "./audit-clock";
import type { AuditEventAppender } from "./audit-event-appender";
import {
  invalidAuditEventError,
  type AuditEventRecord,
  type InvalidAuditEventError,
  type JsonObject,
  type JsonValue,
  type RecordAuditEventInput,
} from "./audit-event";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalidJson = Symbol("invalid-json");

type InvalidJson = typeof invalidJson;

export class AuditEventService {
  constructor(
    private readonly appender: AuditEventAppender,
    private readonly clock: AuditClock,
  ) {}

  async record(
    input: RecordAuditEventInput,
  ): Promise<Result<AuditEventRecord, InvalidAuditEventError>> {
    const event = createAuditEvent(input, this.clock);

    if (event === null) {
      return err(invalidAuditEventError());
    }

    await this.appender.append(event);

    return ok(event);
  }
}

function createAuditEvent(
  input: RecordAuditEventInput,
  clock: AuditClock,
): AuditEventRecord | null {
  try {
    if (
      !isUuid(input.actorId) ||
      !isNonblank(input.entityId) ||
      !isNonblank(input.action) ||
      !isNonblank(input.entityType) ||
      !isOptionalIpAddress(input.sourceIp)
    ) {
      return null;
    }

    const occurredAt = clock.now();

    if (
      !(occurredAt instanceof Date) ||
      !Number.isFinite(occurredAt.getTime())
    ) {
      return null;
    }

    const previousValues = cloneSnapshot(input.previousValues);
    const newValues = cloneSnapshot(input.newValues);

    if (previousValues === invalidJson || newValues === invalidJson) {
      return null;
    }

    return Object.freeze({
      actorId: input.actorId,
      occurredAt: Date.prototype.toISOString.call(occurredAt),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      previousValues,
      newValues,
      sourceIp: input.sourceIp ?? null,
    });
  } catch {
    return null;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalIpAddress(
  value: unknown,
): value is string | null | undefined {
  return value === undefined || value === null || isIpAddress(value);
}

function isIpAddress(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    return false;
  }

  return isIpv4Address(value) || isIpv6Address(value);
}

function isIpv4Address(value: string): boolean {
  const segments = value.split(".");

  return (
    segments.length === 4 &&
    segments.every(
      (segment) => /^(0|[1-9]\d{0,2})$/.test(segment) && Number(segment) <= 255,
    )
  );
}

function isIpv6Address(value: string): boolean {
  if (!value.includes(":")) {
    return false;
  }

  let candidate = value;
  const lastColon = candidate.lastIndexOf(":");
  const possibleIpv4Tail = candidate.slice(lastColon + 1);

  if (possibleIpv4Tail.includes(".")) {
    if (!isIpv4Address(possibleIpv4Tail)) {
      return false;
    }

    candidate = `${candidate.slice(0, lastColon)}:0:0`;
  }

  const halves = candidate.split("::");

  if (halves.length > 2) {
    return false;
  }

  const groups = halves.flatMap((half) => (half === "" ? [] : half.split(":")));

  if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) {
    return false;
  }

  return halves.length === 2 ? groups.length < 8 : groups.length === 8;
}

function cloneSnapshot(
  value: JsonObject | null | undefined,
): JsonObject | null | InvalidJson {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isPlainObject(value)) {
    return invalidJson;
  }

  const cloned = cloneJsonValue(value, new WeakSet<object>());

  return cloned === invalidJson || !isPlainObject(cloned)
    ? invalidJson
    : cloned;
}

function cloneJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
): JsonValue | InvalidJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : invalidJson;
  }

  if (typeof value !== "object" || ancestors.has(value)) {
    return invalidJson;
  }

  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return cloneJsonArray(value, ancestors);
    }

    if (!isPlainObject(value)) {
      return invalidJson;
    }

    const cloned: Record<string, JsonValue> = {};

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        return invalidJson;
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key);

      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return invalidJson;
      }

      const clonedValue = cloneJsonValue(descriptor.value, ancestors);

      if (clonedValue === invalidJson) {
        return invalidJson;
      }

      Object.defineProperty(cloned, key, {
        value: clonedValue,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }

    return Object.freeze(cloned);
  } finally {
    ancestors.delete(value);
  }
}

function cloneJsonArray(
  value: readonly unknown[],
  ancestors: WeakSet<object>,
): readonly JsonValue[] | InvalidJson {
  const ownKeys = Reflect.ownKeys(value);

  if (
    ownKeys.length !== value.length + 1 ||
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" &&
          (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)),
    )
  ) {
    return invalidJson;
  }

  const cloned: JsonValue[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));

    if (descriptor === undefined || !("value" in descriptor)) {
      return invalidJson;
    }

    const clonedValue = cloneJsonValue(descriptor.value, ancestors);

    if (clonedValue === invalidJson) {
      return invalidJson;
    }

    cloned.push(clonedValue);
  }

  return Object.freeze(cloned);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}
