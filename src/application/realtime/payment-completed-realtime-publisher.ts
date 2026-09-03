import type { PaymentCompleted } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { RealtimeDomainEvent } from "./realtime-event";

/** Publishes committed payment and settlement state without private notes. */
export class PaymentCompletedRealtimePublisher implements DomainEventPublisher<PaymentCompleted> {
  constructor(
    private readonly publisher: DomainEventPublisher<RealtimeDomainEvent>,
  ) {}

  async publish(events: readonly PaymentCompleted[]): Promise<void> {
    await this.publisher.publish(
      Object.freeze(
        events.map((event) =>
          Object.freeze({
            type: "payment.completed" as const,
            occurredAt: event.occurredAt,
            payload: Object.freeze({
              restaurantId: event.payload.restaurantId,
              entityId: event.payload.paymentId,
              entityType: "payment",
              data: Object.freeze({
                orderId: event.payload.orderId,
                basketId: event.payload.basketId,
                amount: event.payload.amount,
                basketPaidAmount: event.payload.basketPaidAmount,
                basketOutstandingBalance:
                  event.payload.basketOutstandingBalance,
                basketStatus: event.payload.basketStatus,
                orderStatus: event.payload.orderStatus,
                recordedAt: event.payload.recordedAt,
              }),
            }),
          }),
        ),
      ),
    );
  }
}
