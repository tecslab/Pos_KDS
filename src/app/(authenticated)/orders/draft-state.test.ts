import { describe, expect, it } from "vitest";

import type { PosOrderingContextProduct } from "@/application";

import {
  GENERAL_BASKET_ID,
  basketSubtotal,
  createDraftLine,
  draftReducer,
  draftTotal,
  initialDraftState,
  lineTotal,
} from "./draft-state";

const product: PosOrderingContextProduct = {
  id: "product-1",
  productVersionId: "product-version-1",
  versionNumber: 3,
  name: "Taco",
  printerAlias: "TACO",
  displayOrder: 1,
  unitPrice: 3.5,
  tax: {
    taxRateId: "tax-1",
    code: "IVA",
    name: "IVA",
    rate: 0.15,
    priceIncludesTax: true,
  },
  options: [
    {
      id: "option-cheese",
      name: "Queso",
      priceAdjustment: 0.5,
      displayOrder: 1,
    },
    {
      id: "option-salsa",
      name: "Salsa",
      priceAdjustment: null,
      displayOrder: 2,
    },
  ],
  removableIngredients: [
    {
      id: "removal-onion",
      name: "Sin cebolla",
      priceAdjustment: null,
      displayOrder: 1,
    },
  ],
};

function line(overrides: Partial<Parameters<typeof createDraftLine>[0]> = {}) {
  return createDraftLine({
    id: "line-1",
    basketId: GENERAL_BASKET_ID,
    product,
    selectedOptionIds: [],
    selectedRemovalIds: [],
    observation: "",
    quantity: 1,
    ...overrides,
  });
}

describe("PoS local draft state", () => {
  it("selects a location and keeps basket selection local", () => {
    let state = draftReducer(initialDraftState, {
      type: "select-location",
      locationId: "table-4",
      restaurantId: "restaurant-1",
    });
    state = draftReducer(state, {
      type: "add-basket",
      basket: { id: "basket-ana", name: "Ana" },
    });

    expect(state.locationId).toBe("table-4");
    expect(state.selectedBasketId).toBe("basket-ana");
    expect(state.baskets).toEqual([
      { id: GENERAL_BASKET_ID, name: "General" },
      { id: "basket-ana", name: "Ana" },
    ]);
  });

  it("keeps only modifications allowed by the selected product", () => {
    const configured = line({
      selectedOptionIds: ["option-cheese", "not-allowed"],
      selectedRemovalIds: ["removal-onion", "also-not-allowed"],
    });

    expect(configured.options).toEqual([
      { id: "option-cheese", name: "Queso", priceAdjustment: 0.5 },
    ]);
    expect(configured.removableIngredients).toEqual([
      { id: "removal-onion", name: "Sin cebolla", priceAdjustment: null },
    ]);
  });

  it("groups only identical product version, basket, modifications, and observation", () => {
    let state = draftReducer(initialDraftState, {
      type: "add-line",
      line: line({
        id: "line-1",
        quantity: 2,
        selectedOptionIds: ["option-cheese"],
      }),
    });
    state = draftReducer(state, {
      type: "add-line",
      line: line({
        id: "line-2",
        quantity: 1,
        selectedOptionIds: ["option-cheese"],
      }),
    });
    state = draftReducer(state, {
      type: "add-line",
      line: line({ id: "line-3", observation: "Sin picante" }),
    });
    state = draftReducer(state, {
      type: "add-line",
      line: line({ id: "line-4", basketId: "basket-ana" }),
    });

    expect(state.lines).toHaveLength(3);
    expect(state.lines[0]?.quantity).toBe(3);
  });

  it("uses supplied price and explicit adjustments for line and basket totals", () => {
    const general = line({
      selectedOptionIds: ["option-cheese"],
      quantity: 2,
    });
    const ana = line({ id: "line-ana", basketId: "basket-ana", quantity: 3 });

    expect(lineTotal(general)).toBe(8);
    expect(basketSubtotal([general, ana], GENERAL_BASKET_ID)).toBe(8);
    expect(basketSubtotal([general, ana], "basket-ana")).toBe(10.5);
    expect(draftTotal([general, ana])).toBe(18.5);
  });

  it("updates quantities, removes zero-quantity lines, and clears a draft", () => {
    let state = draftReducer(initialDraftState, {
      type: "add-line",
      line: line(),
    });
    state = draftReducer(state, {
      type: "set-line-quantity",
      lineId: "line-1",
      quantity: 4,
    });
    expect(state.lines[0]?.quantity).toBe(4);

    state = draftReducer(state, {
      type: "set-line-quantity",
      lineId: "line-1",
      quantity: 0,
    });
    expect(state.lines).toEqual([]);

    state = draftReducer(state, {
      type: "select-location",
      locationId: "table-1",
      restaurantId: "restaurant-1",
    });
    state = draftReducer(state, { type: "clear" });
    expect(state).toEqual(initialDraftState);
  });

  it("snapshots the product version and tax data in each private line", () => {
    const configured = line({ observation: "  bien cocido  " });

    expect(configured.productVersionId).toBe("product-version-1");
    expect(configured.productVersionNumber).toBe(3);
    expect(configured.tax).toEqual(product.tax);
    expect(configured.observation).toBe("bien cocido");
  });

  it("clears lines and individual baskets when the selected location changes restaurant", () => {
    let state = draftReducer(initialDraftState, {
      type: "select-location",
      locationId: "restaurant-1-table-1",
      restaurantId: "restaurant-1",
    });
    state = draftReducer(state, {
      type: "add-basket",
      basket: { id: "basket-ana", name: "Ana" },
    });
    state = draftReducer(state, {
      type: "add-line",
      line: line({ basketId: "basket-ana" }),
    });

    state = draftReducer(state, {
      type: "select-location",
      locationId: "restaurant-2-window-1",
      restaurantId: "restaurant-2",
    });

    expect(state.locationId).toBe("restaurant-2-window-1");
    expect(state.locationRestaurantId).toBe("restaurant-2");
    expect(state.baskets).toEqual([{ id: GENERAL_BASKET_ID, name: "General" }]);
    expect(state.selectedBasketId).toBe(GENERAL_BASKET_ID);
    expect(state.lines).toEqual([]);
  });
});
