// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PosOrderingContext } from "@/application";

import { OrderDraftComposer } from "./order-draft-composer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const orderingContext: PosOrderingContext = {
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
          products: Array.from({ length: 40 }, (_, index) => ({
            id: `product-${index}`,
            productVersionId: `version-${index}`,
            versionNumber: 1,
            name: index === 0 ? "Taco mixto" : `Taco ${index}`,
            printerAlias: "COCINA",
            displayOrder: index,
            unitPrice: 4.5,
            tax: {
              taxRateId: "tax-1",
              code: "IVA",
              name: "IVA 15%",
              rate: 0.15,
              priceIncludesTax: true,
            },
            options: [],
            removableIngredients: [],
          })),
        },
      ],
    },
  ],
};

const fetchMock = vi.fn();

function renderedComposer() {
  const container = document.createElement("div");
  document.body.append(container);
  return { container, root: createRoot(container) };
}

async function mount(root: Root) {
  await act(async () => {
    root.render(<OrderDraftComposer />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  expect(found).toBeInstanceOf(HTMLButtonElement);
  return found!;
}

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(orderingContext),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("OrderDraftComposer", () => {
  it("commits a representative add-to-draft interaction to the visible PoS DOM before the 200 ms deadline", async () => {
    const { container, root } = renderedComposer();
    await mount(root);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Mesa 1");

    await act(async () => {
      button(container, "Mesa 1").click();
    });
    await act(async () => {
      button(container, "Taco mixto").click();
    });

    const startedAt = performance.now();
    await act(async () => {
      button(container, "Agregar a la cuenta").click();
    });
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(container.textContent).toContain("Taco mixto");
    expect(
      container.querySelector('[aria-label="Total de la orden"]')?.textContent,
    ).toContain("4,50");
    expect(elapsedMilliseconds).toBeLessThan(200);
    await act(async () => root.unmount());
  });
});
