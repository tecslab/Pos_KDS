import type { DomainEvent } from "./domain-event";

export type OrderDeliveredPayload = Readonly<{
  orderId: string;
  restaurantId: string;
  serviceLocationId: string;
  orderNumber: string;
  assignedWaiterId: string;
  previousStatus: "ON_THE_WAY";
  status: "DELIVERED";
  deliveredById: string;
  readyAt: string;
  onTheWayAt: string;
  deliveredAt: string;
  updatedAt: string;
}>;

export type OrderDelivered = DomainEvent<
  "order.delivered",
  OrderDeliveredPayload
>;
