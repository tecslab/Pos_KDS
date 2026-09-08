// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { registerInventoryAdjustment, registerInventoryWaste } = vi.hoisted(
  () => ({
    registerInventoryAdjustment: vi.fn(),
    registerInventoryWaste: vi.fn(),
  }),
);

vi.mock("./actions", () => ({
  registerInventoryAdjustment,
  registerInventoryWaste,
}));

import { AdjustmentWasteRegistrationForms } from "./adjustment-waste-registration-forms";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const restaurantId = "30000000-0000-4000-8000-000000000001";
const itemId = "31000000-0000-4000-8000-000000000001";
const restaurants = [{ id: restaurantId, name: "Centro" }] as const;
const items = [
  { id: itemId, restaurantId, name: "Tomate", unitOfMeasure: "kg" },
] as const;

function renderedForms() {
  const container = document.createElement("div");
  document.body.append(container);
  return { container, root: createRoot(container) };
}

async function mount(root: Root, canAdjust = true, canWaste = true) {
  await act(async () => {
    root.render(
      <AdjustmentWasteRegistrationForms
        restaurants={restaurants}
        items={items}
        canRegisterAdjustment={canAdjust}
        canRegisterWaste={canWaste}
      />,
    );
  });
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

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("AdjustmentWasteRegistrationForms", () => {
  it("shows only the authorized operation and explains signed adjustment versus positive waste semantics", async () => {
    const { container, root } = renderedForms();
    await mount(root, true, false);

    expect(container.textContent).toContain("Registrar ajuste de inventario");
    expect(container.textContent).not.toContain("Registrar desperdicio");
    expect(container.textContent).toContain("valor positivo");
    expect(container.textContent).toContain("negativo");
    expect(
      container.querySelector('[name="quantity"]')?.getAttribute("min"),
    ).toBe("-99999999999.999");
    expect(container.textContent).toContain("Diferencia de inventario (kg)");
    expect(
      container.querySelector(
        '[aria-label="Unidad del artículo seleccionado para ajuste"]',
      ),
    ).toHaveProperty("value", "kg");
    expect(container.innerHTML).toContain("min-h-12");
    await act(async () => root.unmount());
  });

  it("submits an adjustment once and presents the returned balance as accessible status", async () => {
    registerInventoryAdjustment.mockResolvedValue({
      status: "success",
      operation: "ADJUSTMENT",
      newBalance: "12.500",
      unitOfMeasure: "kg",
    });
    const { container, root } = renderedForms();
    await mount(root, true, false);
    const form = container.querySelector("form") as HTMLFormElement;
    setValue(form.elements.namedItem("quantity") as HTMLInputElement, "-1.5");
    setValue(
      form.elements.namedItem("reason") as HTMLTextAreaElement,
      "Conteo físico",
    );

    await submit(form);

    expect(registerInventoryAdjustment).toHaveBeenCalledTimes(1);
    expect(registerInventoryAdjustment.mock.calls[0]?.[0]).toBeInstanceOf(
      FormData,
    );
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Nuevo saldo: 12.500 kg",
    );
    await act(async () => root.unmount());
  });

  it("locks a movement form while a registration is pending to prevent duplicates", async () => {
    let resolveRegistration: (value: InventoryMovementResult) => void = () => {
      throw new Error("Registration resolver was not initialized.");
    };
    registerInventoryAdjustment.mockImplementation(
      () =>
        new Promise<InventoryMovementResult>((resolve) => {
          resolveRegistration = resolve;
        }),
    );
    const { container, root } = renderedForms();
    await mount(root, true, false);
    const form = container.querySelector("form") as HTMLFormElement;
    setValue(form.elements.namedItem("quantity") as HTMLInputElement, "1");
    setValue(
      form.elements.namedItem("reason") as HTMLTextAreaElement,
      "Conteo físico",
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

    expect(registerInventoryAdjustment).toHaveBeenCalledTimes(1);
    expect((form.querySelector("button") as HTMLButtonElement).disabled).toBe(
      true,
    );
    resolveRegistration({
      status: "success",
      operation: "ADJUSTMENT",
      newBalance: "13.500",
      unitOfMeasure: "kg",
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => root.unmount());
  });

  it("requires positive waste input and displays a failed stock check as an alert without false success", async () => {
    registerInventoryWaste.mockResolvedValue({
      status: "error",
      message:
        "No se puede registrar el movimiento porque dejaría el inventario con saldo negativo.",
    });
    const { container, root } = renderedForms();
    await mount(root, false, true);
    const form = container.querySelector("form") as HTMLFormElement;
    const quantity = form.elements.namedItem("quantity") as HTMLInputElement;
    expect(quantity.min).toBe("0.001");
    expect(container.textContent).toContain("cantidad positiva");
    setValue(quantity, "2");
    setValue(form.elements.namedItem("reason") as HTMLTextAreaElement, "Daño");

    await submit(form);

    expect(registerInventoryWaste).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "saldo negativo",
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => root.unmount());
  });
});

type InventoryMovementResult = Readonly<{
  status: "success";
  operation: "ADJUSTMENT";
  newBalance: string;
  unitOfMeasure: string;
}>;
