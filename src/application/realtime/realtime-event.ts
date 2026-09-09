import type { DomainEvent } from "../../domain";

export const realtimeTopics = [
  "orders",
  "kitchen",
  "delivery",
  "payments",
  "inventory",
  "production",
] as const;

export type RealtimeTopic = (typeof realtimeTopics)[number];

export const realtimeEventNames = [
  "order.created",
  "order.modified",
  "order.cancelled",
  "kitchen.status.updated",
  "delivery.status.updated",
  "payment.completed",
  "inventory.updated",
  "inventory.alert",
  "production.completed",
] as const;

export type RealtimeEventName = (typeof realtimeEventNames)[number];

export type RealtimePrimitive = string | number | boolean | null;

export type RealtimeValue =
  | RealtimePrimitive
  | readonly RealtimeValue[]
  | Readonly<{ [key: string]: RealtimeValue }>;

export type RealtimeData = Readonly<{ [key: string]: RealtimeValue }>;

export type RealtimeDomainEventPayload = Readonly<{
  restaurantId: string;
  entityId: string;
  entityType: string;
  data: RealtimeData;
}>;

export type RealtimeDomainEvent = DomainEvent<
  RealtimeEventName,
  RealtimeDomainEventPayload
>;

export type RealtimeEnvelopeV1 = Readonly<{
  version: 1;
  occurredAt: string;
  restaurantId: string;
  entityId: string;
  entityType: string;
  data: RealtimeData;
}>;

export type RealtimePublication = Readonly<{
  topic: RealtimeTopic;
  eventName: RealtimeEventName;
  envelope: RealtimeEnvelopeV1;
}>;

export type RealtimeMessage = Readonly<{
  eventName: RealtimeEventName;
  envelope: RealtimeEnvelopeV1;
}>;

export type InvalidRealtimeEventError = Readonly<{
  kind: "realtime-mapping-error";
  code: "INVALID_REALTIME_EVENT";
}>;
