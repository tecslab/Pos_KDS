// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { registerInventoryPurchase } = vi.hoisted(() => ({
  registerInventoryPurchase: vi.fn(),
}));

vi.mock("./actions", () => ({ registerInventoryPurchase }));

import { PurchaseRegistrationForm } from "./purchase-registration-form";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const restaurantOne = "30000000-0000-4000-8000-000000000001";
const restaurantTwo = "30000000-0000-4000-8000-000000000002";

const restaurants = [
  { id: restaurantOne, name: "Centro" },
  { id: restaurantTwo, name: "Norte" },
] as const;
const items = [
  {
    id: "31000000-0000-4000-8000-000000000001",
    restaurantId: restaurantOne,
    name: "Tomate",
    unitOfMeasure: "kg",
  },
  {
    id: "31000000-0000-4000-8000-000000000002",
    restaurantId: restaurantTwo,
    name: "Servilleta",
    unitOfMeasure: "unidad",
  },
] as const;
const categories = [
  {
    id: "32000000-0000-4000-8000-000000000001",
    restaurantId: restaurantOne,
    code: "INGREDIENTS",
    name: "Ingredientes",
  },
  {
    id: "32000000-0000-4000-8000-000000000002",
    restaurantId: restaurantTwo,
    code: "SUPPLIES",
    name: "Suministros",
  },
] as const;

function renderedForm() {
  const container = document.createElement("div");
  document.body.append(container);
  return { container, root: createRoot(container) };
}

async function mount(root: Root, empty = false) {
  await act(async () => {
    root.render(
      <PurchaseRegistrationForm
        restaurants={empty ? [] : restaurants}
        items={empty ? [] : items}
        expenseCategories={empty ? [] : categories}
      />,
    );
  });
}

async function select(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  expect(setter).toBeDefined();
  await act(async () => {
    setter!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("PurchaseRegistrationForm", () => {
  it("renders the complete one-line purchase fields with large accessible controls", async () => {
    const { container, root } = renderedForm();
    await mount(root);

    for (const name of [
      "restaurantId",
      "expenseCategoryId",
      "inventoryItemId",
      "quantity",
      "unitPrice",
      "supplierName",
      "comments",
    ]) {
      expect(container.querySelector(`[name=${name}]`)).not.toBeNull();
    }
    expect(container.textContent).toContain("Proveedor (opcional)");
    expect(container.textContent).toContain("Comentarios (opcional)");
    expect(container.textContent).toContain("Costo unitario (USD)");
    expect(
      container.querySelector('[name="unitPrice"]')?.getAttribute("aria-label"),
    ).toContain("USD");
    expect(container.querySelector("button")?.textContent).toBe(
      "Registrar compra",
    );
    expect(container.innerHTML).toContain("min-h-12");
    await act(async () => root.unmount());
  });

  it("filters selections by restaurant and shows the selected item unit as read-only", async () => {
    const { container, root } = renderedForm();
    await mount(root);
    const unit = container.querySelector(
      '[aria-label="Unidad del artículo seleccionado"]',
    ) as HTMLInputElement;
    expect(unit.value).toBe("kg");
    expect(unit.readOnly).toBe(true);

    await select(
      container.querySelector('[name="restaurantId"]') as HTMLSelectElement,
      restaurantTwo,
    );

    expect(
      (container.querySelector('[name="inventoryItemId"]') as HTMLSelectElement)
        .value,
    ).toBe(items[1].id);
    expect(
      (
        container.querySelector(
          '[name="expenseCategoryId"]',
        ) as HTMLSelectElement
      ).value,
    ).toBe(categories[1].id);
    expect(unit.value).toBe("unidad");
    expect(container.textContent).not.toContain("Tomate");
    await act(async () => root.unmount());
  });

  it("disables submission and explains how to recover when selectable context is absent", async () => {
    const { container, root } = renderedForm();
    await mount(root, true);

    expect(
      (container.querySelector("button") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "artículos y categorías de gasto activos",
    );
    await act(async () => root.unmount());
  });
});
