import type { DomainEvent } from "./domain-event";

export type PaymentCompletedPayload = Readonly<{
  paymentId: string;
  restaurantId: string;
  orderId: string;
  basketId: string;
  amount: string;
  basketPaidAmount: string;
  basketOutstandingBalance: string;
  basketStatus: "PENDING" | "PAID";
  orderStatus: "DELIVERED" | "PAID";
  recordedAt: string;
}>;

export type PaymentCompleted = DomainEvent<
  "payment.completed",
  PaymentCompletedPayload
>;
