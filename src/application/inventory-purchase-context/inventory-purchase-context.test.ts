import { describe, expect, it } from "vitest";

import { InventoryPurchaseContextService } from "./inventory-purchase-context";

const restaurantId = "30000000-0000-4000-8000-000000000001";

describe("InventoryPurchaseContextService", () => {
  it("keeps only a context scoped to active restaurants", async () => {
    const service = new InventoryPurchaseContextService({
      read: async () =>
        Object.freeze({
          restaurants: Object.freeze([{ id: restaurantId, name: "Carnales" }]),
          items: Object.freeze([
            {
              id: "31000000-0000-4000-8000-000000000001",
              restaurantId,
              name: "Tomate",
              unitOfMeasure: "kg",
            },
          ]),
          expenseCategories: Object.freeze([
            {
              id: "32000000-0000-4000-8000-000000000001",
              restaurantId,
              code: "INGREDIENTS",
              name: "Ingredientes",
            },
          ]),
        }),
    });

    await expect(service.list()).resolves.toMatchObject({
      ok: true,
      value: {
        restaurants: [{ id: restaurantId, name: "Carnales" }],
      },
    });
  });

  it("fails closed when the reader returns an orphaned selectable record", async () => {
    const service = new InventoryPurchaseContextService({
      read: async () =>
        Object.freeze({
          restaurants: Object.freeze([]),
          items: Object.freeze([
            {
              id: "31000000-0000-4000-8000-000000000001",
              restaurantId,
              name: "Tomate",
              unitOfMeasure: "kg",
            },
          ]),
          expenseCategories: Object.freeze([]),
        }),
    });

    await expect(service.list()).resolves.toEqual({
      ok: false,
      error: {
        kind: "inventory-purchase-context-error",
        code: "OPERATION_FAILED",
      },
    });
  });
});
