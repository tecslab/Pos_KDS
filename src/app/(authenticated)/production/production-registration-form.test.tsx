// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { completeProductionBatch, refresh } = vi.hoisted(() => ({
  completeProductionBatch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("./actions", () => ({ completeProductionBatch }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ProductionRegistrationForm } from "./production-registration-form";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const recipes = [
  {
    id: "40000000-0000-4000-8000-000000000001",
    restaurantId: "20000000-0000-4000-8000-000000000001",
    restaurantName: "Centro",
    productId: "50000000-0000-4000-8000-000000000001",
    productName: "Salsa",
    outputInventoryItemId: "60000000-0000-4000-8000-000000000001",
    outputInventoryItemName: "Salsa preparada",
    name: "Salsa de la casa",
    isActive: true,
    versionId: "70000000-0000-4000-8000-000000000001",
    versionNumber: 3,
    availableVersionNumbers: [1, 2, 3],
    producedQuantity: 1,
    producedUnit: "litro",
    ingredients: [],
  },
] as const;

function renderedForm() {
  const container = document.createElement("div");
  document.body.append(container);
  return { container, root: createRoot(container) };
}

function setValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  expect(setter).toBeDefined();
  setter!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function mount(root: Root) {
  await act(async () => {
    root.render(<ProductionRegistrationForm recipes={recipes} />);
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("ProductionRegistrationForm", () => {
  it("shows the active recipe version and its immutable output unit with keyboard-sized controls", async () => {
    const { container, root } = renderedForm();
    await mount(root);

    expect(container.textContent).toContain("Salsa de la casa · v3");
    expect(container.textContent).toContain("Cantidad producida (litro)");
    expect(
      container.querySelector('[name="producedQuantity"]')?.getAttribute("min"),
    ).toBe("0.001");
    expect(container.innerHTML).toContain("min-h-12");
    expect(
      container.querySelector(
        '[aria-label="Artículo producido por la receta seleccionada"]',
      ),
    ).toHaveProperty("value", "Salsa preparada");
    await act(async () => root.unmount());
  });

  it("submits once, presents accessible success, and refreshes immutable history", async () => {
    completeProductionBatch.mockResolvedValue({
      status: "success",
      producedQuantity: "5.000",
      unitOfMeasure: "litro",
    });
    const { container, root } = renderedForm();
    await mount(root);
    const form = container.querySelector("form") as HTMLFormElement;
    setValue(
      form.elements.namedItem("producedQuantity") as HTMLInputElement,
      "5",
    );

    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(completeProductionBatch).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Producción completada",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("locks duplicate completion and gives an accessible insufficient-stock failure", async () => {
    let resolveCompletion: (value: unknown) => void = () => {
      throw new Error("Completion resolver was not initialized.");
    };
    completeProductionBatch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCompletion = resolve;
        }),
    );
    const { container, root } = renderedForm();
    await mount(root);
    const form = container.querySelector("form") as HTMLFormElement;
    setValue(
      form.elements.namedItem("producedQuantity") as HTMLInputElement,
      "5",
    );

    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(completeProductionBatch).toHaveBeenCalledTimes(1);
    expect((form.querySelector("button") as HTMLButtonElement).disabled).toBe(
      true,
    );

    resolveCompletion({
      status: "error",
      message:
        "No hay ingredientes suficientes para completar esta producción.",
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "ingredientes suficientes",
    );
    await act(async () => root.unmount());
  });
});
