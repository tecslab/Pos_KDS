import type { DomainEvent } from "./domain-event";

export type OrderOnTheWayPayload = Readonly<{
  orderId: string;
  restaurantId: string;
  serviceLocationId: string;
  orderNumber: string;
  assignedWaiterId: string;
  previousStatus: "READY";
  status: "ON_THE_WAY";
  collectedById: string;
  readyAt: string;
  onTheWayAt: string;
  updatedAt: string;
}>;

export type OrderOnTheWay = DomainEvent<
  "order.on-the-way",
  OrderOnTheWayPayload
>;
