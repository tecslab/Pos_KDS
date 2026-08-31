import type { DomainEvent } from "./domain-event";

export type OrderCancelledPayload = Readonly<{
  orderId: string;
  restaurantId: string;
  serviceLocationId: string;
  orderNumber: string;
  assignedWaiterId: string;
  previousStatus: "PENDING" | "READY";
  status: "CANCELLED";
  totalAmount: string;
  cancelledById: string;
  reason: string;
  cancelledAt: string;
  updatedAt: string;
}>;

export type OrderCancelled = DomainEvent<
  "order.cancelled",
  OrderCancelledPayload
>;
