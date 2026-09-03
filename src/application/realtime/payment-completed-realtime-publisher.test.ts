import { describe, expect, it, vi } from "vitest";

import type { PaymentCompleted } from "../../domain";
import { PaymentCompletedRealtimePublisher } from "./payment-completed-realtime-publisher";

describe("PaymentCompletedRealtimePublisher", () => {
  it("publishes a private-data-free payment projection", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const publisher = new PaymentCompletedRealtimePublisher({ publish });
    const event: PaymentCompleted = {
      type: "payment.completed",
      occurredAt: "2026-09-02T10:00:00.000Z",
      payload: {
        paymentId: "44000000-0000-4000-8000-000000000001",
        restaurantId: "30000000-0000-4000-8000-000000000001",
        orderId: "41000000-0000-4000-8000-000000000001",
        basketId: "42000000-0000-4000-8000-000000000001",
        amount: "5.00",
        basketPaidAmount: "5.00",
        basketOutstandingBalance: "5.00",
        basketStatus: "PENDING",
        orderStatus: "DELIVERED",
        recordedAt: "2026-09-02T10:00:00.000Z",
      },
    };
    await publisher.publish([event]);
    expect(publish).toHaveBeenCalledWith([
      {
        type: "payment.completed",
        occurredAt: event.occurredAt,
        payload: {
          restaurantId: event.payload.restaurantId,
          entityId: event.payload.paymentId,
          entityType: "payment",
          data: {
            orderId: event.payload.orderId,
            basketId: event.payload.basketId,
            amount: "5.00",
            basketPaidAmount: "5.00",
            basketOutstandingBalance: "5.00",
            basketStatus: "PENDING",
            orderStatus: "DELIVERED",
            recordedAt: event.payload.recordedAt,
          },
        },
      },
    ]);
  });
});
