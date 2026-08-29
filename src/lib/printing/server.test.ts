import { describe, expect, it, vi } from "vitest";

import type { ConfirmedOrder } from "../../application";

vi.mock("server-only", () => ({}));

import {
  requestKitchenTicketAfterPersistence,
  toKitchenTicketRequest,
} from "./server";

const order: ConfirmedOrder = {
  orderId: "order-1",
  restaurantId: "restaurant-1",
  serviceLocationId: "location-1",
  orderNumber: "ORD-42",
  assignedWaiterId: "waiter-1",
  status: "PENDING",
  notes: null,
  totalAmount: "15.00",
  confirmedAt: "2026-08-28T10:00:00.000Z",
  baskets: [
    {
      id: "basket-1",
      status: "PENDING",
      totalAmount: "15.00",
      lines: [
        {
          id: "line-1",
          productVersionId: "version-1",
          productName: "Taco",
          quantity: 2,
          baseUnitPrice: "7.00",
          finalUnitPrice: "7.50",
          lineTotal: "15.00",
          taxCode: "IVA",
          taxName: "IVA",
          taxRate: "0.15",
          priceIncludesTax: true,
          selectedOptions: [
            { id: "option-1", name: "Queso", priceAdjustment: "0.50" },
          ],
          removedIngredients: [
            { id: "ingredient-1", name: "Cebolla", priceAdjustment: null },
          ],
          observations: "Bien cocido",
        },
      ],
    },
  ],
};

describe("kitchen ticket request", () => {
  it("creates a canonical kitchen ticket for an already-confirmed order", () => {
    const request = toKitchenTicketRequest(order);

    expect(request).toMatchObject({
      jobId: "kitchen-ticket:order-1",
      attemptNumber: 1,
      restaurantId: "restaurant-1",
      logicalTarget: "kitchen:default",
      document: {
        id: "order-1",
        type: "KITCHEN_TICKET",
        lines: [
          { text: "Orden ORD-42", emphasized: true, alignment: "CENTER" },
          { text: "2 × Taco", emphasized: true },
          { text: "+ Queso" },
          { text: "Sin Cebolla" },
          { text: "Bien cocido" },
        ],
      },
    });
    expect(request.attemptId).not.toHaveLength(0);
  });

  it("starts printing without awaiting failures", async () => {
    const requester = {
      printAfterPersistence: vi.fn().mockRejectedValue(new Error("offline")),
    };

    expect(() =>
      requestKitchenTicketAfterPersistence(order, requester),
    ).not.toThrow();
    expect(requester.printAfterPersistence).toHaveBeenCalledOnce();

    await Promise.resolve();
  });
});
