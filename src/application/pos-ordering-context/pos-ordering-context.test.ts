import { describe, expect, it, vi } from "vitest";

import type { PosOrderingContextReader } from "./pos-ordering-context";
import { PosOrderingContextService } from "./pos-ordering-context";

function context() {
  return {
    restaurants: [
      {
        id: "restaurant-1",
        name: "Carnales",
        serviceLocations: [
          {
            id: "location-1",
            name: "Mesa 1",
            type: "TABLE",
            displayOrder: 1,
            allowsMultipleActiveOrders: false,
          },
        ],
        categories: [
          {
            id: "category-1",
            name: "Tacos",
            displayOrder: 1,
            products: [
              {
                id: "product-1",
                productVersionId: "version-1",
                versionNumber: 2,
                name: "Taco mixto",
                printerAlias: "COCINA",
                displayOrder: 1,
                unitPrice: 4.5,
                tax: {
                  taxRateId: "tax-1",
                  code: "IVA",
                  name: "IVA 15%",
                  rate: 0.15,
                  priceIncludesTax: true,
                },
                options: [
                  {
                    id: "option-1",
                    name: "Extra queso",
                    priceAdjustment: 0.5,
                    displayOrder: 1,
                  },
                ],
                removableIngredients: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("PosOrderingContextService", () => {
  it("returns an immutable copy of the reader context", async () => {
    const source = context();
    const reader: PosOrderingContextReader = {
      read: vi.fn().mockResolvedValue(source),
    };

    const result = await new PosOrderingContextService(reader).read();

    expect(result).toEqual({ ok: true, value: source });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a successful read.");
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.restaurants)).toBe(true);
    expect(Object.isFrozen(result.value.restaurants[0])).toBe(true);
    expect(Object.isFrozen(result.value.restaurants[0].categories[0])).toBe(
      true,
    );
    expect(
      Object.isFrozen(
        result.value.restaurants[0].categories[0].products[0].tax,
      ),
    ).toBe(true);
    expect(result.value).not.toBe(source);
  });

  it("treats an empty restaurant collection as a successful result", async () => {
    const reader: PosOrderingContextReader = {
      read: vi.fn().mockResolvedValue({ restaurants: [] }),
    };

    await expect(new PosOrderingContextService(reader).read()).resolves.toEqual(
      {
        ok: true,
        value: { restaurants: [] },
      },
    );
  });

  it("sanitizes reader failures", async () => {
    const reader: PosOrderingContextReader = {
      read: vi.fn().mockRejectedValue(new Error("private database detail")),
    };

    await expect(new PosOrderingContextService(reader).read()).resolves.toEqual(
      {
        ok: false,
        error: {
          kind: "pos-ordering-context-error",
          code: "OPERATION_FAILED",
        },
      },
    );
  });
});
