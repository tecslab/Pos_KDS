import type { DomainEvent } from "./domain-event";

export type OrderReadyPayload = Readonly<{
  orderId: string;
  restaurantId: string;
  serviceLocationId: string;
  orderNumber: string;
  assignedWaiterId: string;
  previousStatus: "PENDING";
  status: "READY";
  markedReadyById: string;
  readyAt: string;
  updatedAt: string;
}>;

export type OrderReady = DomainEvent<"order.ready", OrderReadyPayload>;
