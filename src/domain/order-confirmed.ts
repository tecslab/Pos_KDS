import type { DomainEvent } from "./domain-event";

export type OrderConfirmedPayload = Readonly<{
  orderId: string;
  restaurantId: string;
  serviceLocationId: string;
  orderNumber: string;
  assignedWaiterId: string;
  status: "PENDING";
  totalAmount: string;
}>;

export type OrderConfirmed = DomainEvent<
  "order.confirmed",
  OrderConfirmedPayload
>;
