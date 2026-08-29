import type { DomainEvent } from "./domain-event";

export type OrderUpdatedPayload = Readonly<{
  orderId: string;
  restaurantId: string;
  serviceLocationId: string;
  orderNumber: string;
  assignedWaiterId: string;
  status: "PENDING";
  totalAmount: string;
  updatedAt: string;
}>;

export type OrderUpdated = DomainEvent<"order.updated", OrderUpdatedPayload>;
