import { err, ok, type Result } from "../../domain";

import {
  realtimeEventNames,
  realtimeTopics,
  type InvalidRealtimeEventError,
  type RealtimeData,
  type RealtimeDomainEvent,
  type RealtimeEnvelopeV1,
  type RealtimeEventName,
  type RealtimeMessage,
  type RealtimePublication,
  type RealtimeTopic,
  type RealtimeValue,
} from "./realtime-event";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalidValue = Symbol("invalid-realtime-value");

type InvalidValue = typeof invalidValue;

const routes = Object.freeze({
  "order.created": Object.freeze(["orders", "kitchen", "payments"]),
  "order.modified": Object.freeze(["orders", "kitchen", "payments"]),
  "order.cancelled": Object.freeze([
    "orders",
    "kitchen",
    "delivery",
    "payments",
  ]),
  "kitchen.status.updated": Object.freeze(["kitchen", "orders", "delivery"]),
  "delivery.status.updated": Object.freeze(["delivery", "orders", "payments"]),
  "payment.completed": Object.freeze(["payments", "orders"]),
  "inventory.updated": Object.freeze(["inventory"]),
  "inventory.alert": Object.freeze(["inventory"]),
  "production.completed": Object.freeze(["production", "inventory"]),
} satisfies Readonly<Record<RealtimeEventName, readonly RealtimeTopic[]>>);

const invalidRealtimeEvent: InvalidRealtimeEventError = Object.freeze({
  kind: "realtime-mapping-error",
  code: "INVALID_REALTIME_EVENT",
});

export function mapDomainEventToRealtime(
  event: RealtimeDomainEvent,
): Result<readonly RealtimePublication[], InvalidRealtimeEventError> {
  try {
    return mapDomainEventToRealtimeUnsafe(event);
  } catch {
    return err(invalidRealtimeEvent);
  }
}

function mapDomainEventToRealtimeUnsafe(
  event: RealtimeDomainEvent,
): Result<readonly RealtimePublication[], InvalidRealtimeEventError> {
  const eventName = parseEventName(event?.type);
  const payload = event?.payload;
  const data = cloneRealtimeData(payload?.data);

  if (
    eventName === null ||
    !isCanonicalInstant(event.occurredAt) ||
    !isUuid(payload?.restaurantId) ||
    !isNonblank(payload?.entityId) ||
    !isNonblank(payload?.entityType) ||
    data === invalidValue
  ) {
    return err(invalidRealtimeEvent);
  }

  const envelope: RealtimeEnvelopeV1 = Object.freeze({
    version: 1,
    occurredAt: event.occurredAt,
    restaurantId: payload.restaurantId,
    entityId: payload.entityId,
    entityType: payload.entityType,
    data,
  });
  const publications = routes[eventName].map((topic) =>
    Object.freeze({ topic, eventName, envelope }),
  );

  return ok(Object.freeze(publications));
}

export function realtimeTopicName(
  restaurantId: string,
  topic: RealtimeTopic,
): string | null {
  if (!isUuid(restaurantId) || !isRealtimeTopic(topic)) {
    return null;
  }

  return `restaurant:${restaurantId}:${topic}`;
}

export function parseRealtimeMessage(
  eventNameValue: unknown,
  envelopeValue: unknown,
  expectedRestaurantId: string,
  expectedTopic: RealtimeTopic,
): RealtimeMessage | null {
  try {
    return parseRealtimeMessageUnsafe(
      eventNameValue,
      envelopeValue,
      expectedRestaurantId,
      expectedTopic,
    );
  } catch {
    return null;
  }
}

function parseRealtimeMessageUnsafe(
  eventNameValue: unknown,
  envelopeValue: unknown,
  expectedRestaurantId: string,
  expectedTopic: RealtimeTopic,
): RealtimeMessage | null {
  const eventName = parseEventName(eventNameValue);

  if (
    eventName === null ||
    !isUuid(expectedRestaurantId) ||
    !isRealtimeTopic(expectedTopic) ||
    !(routes[eventName] as readonly RealtimeTopic[]).includes(expectedTopic) ||
    !isPlainObject(envelopeValue) ||
    !hasExactKeys(envelopeValue, [
      "version",
      "occurredAt",
      "restaurantId",
      "entityId",
      "entityType",
      "data",
    ]) ||
    envelopeValue.version !== 1 ||
    envelopeValue.restaurantId !== expectedRestaurantId ||
    !isCanonicalInstant(envelopeValue.occurredAt) ||
    !isNonblank(envelopeValue.entityId) ||
    !isNonblank(envelopeValue.entityType)
  ) {
    return null;
  }

  const data = cloneRealtimeData(envelopeValue.data);

  if (data === invalidValue) {
    return null;
  }

  const envelope: RealtimeEnvelopeV1 = Object.freeze({
    version: 1,
    occurredAt: envelopeValue.occurredAt,
    restaurantId: expectedRestaurantId,
    entityId: envelopeValue.entityId,
    entityType: envelopeValue.entityType,
    data,
  });

  return Object.freeze({ eventName, envelope });
}

function parseEventName(value: unknown): RealtimeEventName | null {
  return typeof value === "string" &&
    (realtimeEventNames as readonly string[]).includes(value)
    ? (value as RealtimeEventName)
    : null;
}

function isRealtimeTopic(value: unknown): value is RealtimeTopic {
  return (
    typeof value === "string" &&
    (realtimeTopics as readonly string[]).includes(value)
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const milliseconds = Date.parse(value);

  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function cloneRealtimeData(value: unknown): RealtimeData | InvalidValue {
  if (!isPlainObject(value)) {
    return invalidValue;
  }

  const cloned = cloneRealtimeValue(value, new WeakSet<object>());

  return cloned === invalidValue || !isPlainObject(cloned)
    ? invalidValue
    : cloned;
}

function cloneRealtimeValue(
  value: unknown,
  ancestors: WeakSet<object>,
): RealtimeValue | InvalidValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : invalidValue;
  }

  if (typeof value !== "object" || ancestors.has(value)) {
    return invalidValue;
  }

  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
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
        return invalidValue;
      }

      const cloned: RealtimeValue[] = [];

      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );

        if (descriptor === undefined || !("value" in descriptor)) {
          return invalidValue;
        }

        const clonedValue = cloneRealtimeValue(descriptor.value, ancestors);

        if (clonedValue === invalidValue) {
          return invalidValue;
        }

        cloned.push(clonedValue);
      }

      return Object.freeze(cloned);
    }

    if (!isPlainObject(value)) {
      return invalidValue;
    }

    const cloned: Record<string, RealtimeValue> = {};

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        return invalidValue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key);

      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return invalidValue;
      }

      const clonedValue = cloneRealtimeValue(descriptor.value, ancestors);

      if (clonedValue === invalidValue) {
        return invalidValue;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);

  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => {
      if (typeof key !== "string" || !expectedKeys.includes(key)) {
        return false;
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key);

      return (
        descriptor !== undefined &&
        descriptor.enumerable &&
        "value" in descriptor
      );
    })
  );
}
