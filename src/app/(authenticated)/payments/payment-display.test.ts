import type { PendingPaymentOrder, RealtimeMessage } from "@/application";
import { describe, expect, it, vi } from "vitest";

import {
  amountExceedsBalance,
  canRegisterSelectedPayment,
  canonicalPaymentAmount,
  paymentDetailSelection,
  paymentRegistrationErrorMessage,
  paymentRegistrationRequest,
  parsePaymentRegistrationResult,
  parsePendingPaymentOrders,
  PaymentRealtimeController,
} from "./payment-display";

const restaurantId = "30000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000001";
const methodId = "43000000-0000-4000-8000-000000000001";
const paymentId = "44000000-0000-4000-8000-000000000001";

const order: PendingPaymentOrder = Object.freeze({
  id: orderId,
  restaurantId,
  orderNumber: "ORD-42",
  status: "DELIVERED",
  serviceLocation: {
    id: "31000000-0000-4000-8000-000000000001",
    name: "Mesa 4",
    type: "TABLE",
  },
  assignedWaiter: { id: userId, displayName: "Ana" },
  totalAmount: "18.50",
  paidAmount: "8.00",
  outstandingBalance: "10.50",
  createdAt: "2026-09-03T10:00:00.000Z",
  deliveredAt: "2026-09-03T10:20:00.000Z",
  baskets: [
    {
      id: basketId,
      status: "PENDING" as const,
      totalAmount: "18.50",
      paidAmount: "8.00",
      outstandingBalance: "10.50",
      createdAt: "2026-09-03T10:00:00.000Z",
      paidAt: null,
      payments: [
        {
          id: paymentId,
          amount: "8.00",
          paymentMethodId: methodId,
          paymentMethodCode: "cash",
          paymentMethodName: "Efectivo",
          recordedBy: { id: userId, displayName: "Ana" },
          recordedAt: "2026-09-03T10:21:00.000Z",
          referenceNumber: null,
          comments: "Primer abono",
        },
      ],
    },
  ],
});

describe("payment display state", () => {
  it("only accepts valid canonical partial-payment amounts and detects overages locally", () => {
    expect(canonicalPaymentAmount("8")).toBe("8.00");
    expect(canonicalPaymentAmount("8.5")).toBe("8.50");
    expect(canonicalPaymentAmount("0")).toBeNull();
    expect(canonicalPaymentAmount("8.999")).toBeNull();
    expect(amountExceedsBalance("10.50", "10.50")).toBe(false);
    expect(amountExceedsBalance("10.51", "10.50")).toBe(true);
  });

  it("strictly accepts the protected list DTO, including immutable per-basket history", () => {
    const parsed = parsePendingPaymentOrders({ orders: [order] });

    expect(parsed).toEqual([order]);
    expect(
      parsePendingPaymentOrders({ orders: [{ ...order, baskets: [] }] }),
    ).toBeNull();
    expect(
      parsePendingPaymentOrders({
        orders: [{ ...order, outstandingBalance: "10.5" }],
      }),
    ).toBeNull();
  });

  it("uses the registration response only when it names the selected basket", () => {
    const response = {
      payment: {
        paymentId,
        orderId,
        basketId,
        basketOutstandingBalance: "2.50",
        basketStatus: "PENDING",
        orderStatus: "DELIVERED",
      },
    };
    expect(parsePaymentRegistrationResult(response, basketId)).toEqual(
      response.payment,
    );
    expect(parsePaymentRegistrationResult(response, methodId)).toBeNull();
  });

  it("resets an order selection to its pending basket and configured method after an API detail refresh", () => {
    const methods = [
      {
        id: methodId,
        restaurantId,
        code: "cash",
        name: "Efectivo",
        displayOrder: 2,
      },
      {
        id: "43000000-0000-4000-8000-000000000002",
        restaurantId,
        code: "card",
        name: "Tarjeta",
        displayOrder: 1,
      },
    ];
    const selection = paymentDetailSelection(order, methods);

    expect(selection).toEqual({
      orderId,
      basketId,
      methodId: "43000000-0000-4000-8000-000000000002",
    });
    expect(
      canRegisterSelectedPayment(order, order.baskets[0], true, false, true),
    ).toBe(true);
    expect(
      canRegisterSelectedPayment(order, order.baskets[0], true, true, true),
    ).toBe(false);
    expect(
      canRegisterSelectedPayment(
        { ...order, status: "READY" },
        order.baskets[0],
        true,
        false,
        true,
      ),
    ).toBe(false);
  });

  it("turns typed payment API failures into clear action feedback", () => {
    expect(
      paymentRegistrationErrorMessage({
        error: { code: "ORDER_NOT_DELIVERED" },
      }),
    ).toBe("Solo se pueden registrar pagos para órdenes entregadas.");
    expect(
      paymentRegistrationErrorMessage({
        error: { code: "PAYMENT_METHOD_UNAVAILABLE" },
      }),
    ).toContain("método seleccionado");
    expect(
      paymentRegistrationErrorMessage({ error: { code: "private" } }),
    ).toBe("No se pudo registrar el pago. Intenta nuevamente.");
  });

  it("builds a chosen-basket partial-payment API request and relies on the response before refresh", () => {
    expect(
      paymentRegistrationRequest(
        basketId,
        methodId,
        canonicalPaymentAmount("3.5")!,
        "REF-7",
        "Abono",
      ),
    ).toEqual({
      basketId,
      paymentMethodId: methodId,
      amount: "3.50",
      referenceNumber: "REF-7",
      comments: "Abono",
    });
    expect(
      paymentRegistrationRequest(basketId, methodId, "3.50", "", ""),
    ).toEqual({
      basketId,
      paymentMethodId: methodId,
      amount: "3.50",
    });
    expect(
      paymentRegistrationRequest(
        basketId,
        methodId,
        "11.00",
        "",
        "",
        "Cliente entregó efectivo adicional",
      ),
    ).toEqual({
      basketId,
      paymentMethodId: methodId,
      amount: "11.00",
      overageReason: "Cliente entregó efectivo adicional",
    });
  });

  it("refetches payment events from the protected APIs and falls back after terminal failure", async () => {
    let onMessage: ((message: RealtimeMessage) => void) | undefined;
    let onTerminalFailure: (() => void) | undefined;
    const refreshPayments = vi.fn().mockResolvedValue(undefined);
    const onStatus = vi.fn();
    const setInterval = vi.fn(
      () => 1 as unknown as ReturnType<typeof globalThis.setInterval>,
    );
    const clearInterval = vi.fn();
    const controller = new PaymentRealtimeController({
      subscriber: {
        subscribe: vi.fn(async (options) => {
          onMessage = options.onMessage;
          onTerminalFailure = options.onTerminalFailure;
          return { unsubscribe: vi.fn() };
        }),
      },
      restaurantIds: [restaurantId],
      refreshPayments,
      onStatus,
      setInterval,
      clearInterval,
    });

    await controller.start();
    expect(refreshPayments).toHaveBeenCalledTimes(1);
    for (const [index, eventName] of [
      "order.created",
      "order.modified",
      "order.cancelled",
      "delivery.status.updated",
      "payment.completed",
    ].entries()) {
      onMessage?.({
        eventName: eventName as RealtimeMessage["eventName"],
        envelope: {
          version: 1,
          occurredAt: "2026-09-03T10:22:00.000Z",
          restaurantId,
          entityId: paymentId,
          entityType: "payment",
          data: {},
        },
      });
      await vi.waitFor(() =>
        expect(refreshPayments).toHaveBeenCalledTimes(index + 2),
      );
    }
    onTerminalFailure?.();
    expect(onStatus).toHaveBeenLastCalledWith("degraded");
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 5_000);
    await controller.stop();
    expect(clearInterval).toHaveBeenCalledWith(1);
  });
});
