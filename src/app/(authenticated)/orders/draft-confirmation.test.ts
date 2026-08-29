import { describe, expect, it, vi } from "vitest";

import {
  createDraftLine,
  draftReducer,
  initialDraftState,
  type DraftState,
} from "./draft-state";
import {
  confirmationActionState,
  confirmationFailureMessage,
  confirmedOrderNumber,
  DraftConfirmationWorkflow,
  toConfirmationInput,
} from "./draft-confirmation";

const product = {
  id: "product-1",
  productVersionId: "10000000-0000-4000-8000-000000000001",
  versionNumber: 1,
  name: "Taco",
  printerAlias: "COCINA",
  displayOrder: 1,
  unitPrice: 5,
  tax: {
    taxRateId: "tax-1",
    code: "IVA",
    name: "IVA",
    rate: 0.15,
    priceIncludesTax: true,
  },
  options: [
    { id: "option-1", name: "Queso", priceAdjustment: 1, displayOrder: 1 },
  ],
  removableIngredients: [
    {
      id: "removal-1",
      name: "Sin cebolla",
      priceAdjustment: null,
      displayOrder: 1,
    },
  ],
} as const;

function draft(): DraftState {
  return {
    ...initialDraftState,
    locationId: "20000000-0000-4000-8000-000000000001",
    locationRestaurantId: "restaurant-1",
    baskets: [...initialDraftState.baskets, { id: "basket-ana", name: "Ana" }],
    lines: [
      createDraftLine({
        id: "line-1",
        basketId: "basket-ana",
        product,
        selectedOptionIds: ["option-1"],
        selectedRemovalIds: ["removal-1"],
        observation: "  Sin picante ",
        quantity: 2,
      }),
    ],
  };
}

function response(status: number, body: unknown = {}) {
  return { status, json: async () => body };
}

describe("PoS draft confirmation mapping", () => {
  it("maps only server-owned confirmation fields and omits empty baskets", () => {
    expect(toConfirmationInput(draft())).toEqual({
      serviceLocationId: "20000000-0000-4000-8000-000000000001",
      baskets: [
        {
          clientCorrelationId: "basket-ana",
          lines: [
            {
              clientCorrelationId: "line-1",
              productVersionId: "10000000-0000-4000-8000-000000000001",
              quantity: 2,
              optionIds: ["option-1"],
              removableIngredientIds: ["removal-1"],
              observations: "Sin picante",
            },
          ],
        },
      ],
    });
  });

  it("does not create a confirmation request for an incomplete draft", () => {
    expect(toConfirmationInput(initialDraftState)).toBeNull();
    expect(toConfirmationInput({ ...draft(), locationId: null })).toBeNull();
  });

  it("uses concise recovery messages and recognizes a canonical order number", () => {
    expect(confirmationFailureMessage(409)).toContain("cambió");
    expect(confirmationFailureMessage(500)).toContain("No se pudo confirmar");
    expect(confirmedOrderNumber({ orderNumber: "ORD-42" })).toBe("ORD-42");
    expect(confirmedOrderNumber({ orderNumber: " " })).toBeNull();
  });

  it("prevents rapid duplicate submits while showing the pending disabled action", async () => {
    let resolveResponse: (value: ReturnType<typeof response>) => void = () => {
      throw new Error("confirmation response was not requested");
    };
    const transport = vi.fn(
      () =>
        new Promise<ReturnType<typeof response>>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const states: unknown[] = [];
    const reset = vi.fn();
    const workflow = new DraftConfirmationWorkflow(
      transport,
      (state) => states.push(state),
      reset,
    );
    const input = toConfirmationInput(draft());

    const first = workflow.submit(input);
    const second = workflow.submit(input);

    expect(transport).toHaveBeenCalledOnce();
    expect(states).toEqual([{ status: "pending" }]);
    expect(confirmationActionState({ status: "pending" }, input)).toEqual({
      disabled: true,
      label: "Confirmando orden…",
    });

    resolveResponse(response(201, { orderNumber: "ORD-42" }));
    await Promise.all([first, second]);

    expect(reset).toHaveBeenCalledWith("ORD-42");
  });

  it("resets the complete draft and shows success only after a 201", async () => {
    const originalDraft = draft();
    let displayedDraft = originalDraft;
    let displayedState: unknown = { status: "idle" };
    let resolveResponse: (value: ReturnType<typeof response>) => void = () => {
      throw new Error("confirmation response was not requested");
    };
    const workflow = new DraftConfirmationWorkflow(
      () =>
        new Promise<ReturnType<typeof response>>((resolve) => {
          resolveResponse = resolve;
        }),
      (state) => {
        displayedState = state;
      },
      () => {
        displayedDraft = draftReducer(displayedDraft, { type: "clear" });
      },
    );

    const confirmation = workflow.submit(toConfirmationInput(displayedDraft));

    expect(displayedDraft).toEqual(originalDraft);
    expect(displayedState).toEqual({ status: "pending" });

    resolveResponse(response(201, { orderNumber: "ORD-43" }));
    await confirmation;

    expect(displayedDraft).toEqual(initialDraftState);
    expect(displayedState).toEqual({
      status: "success",
      orderNumber: "ORD-43",
    });
  });

  it("retains location, baskets, lines, quantities, modifications, and observations on a business failure", async () => {
    const originalDraft = draft();
    let displayedDraft = originalDraft;
    let displayedState: unknown = { status: "idle" };
    const reset = vi.fn(() => {
      displayedDraft = draftReducer(displayedDraft, { type: "clear" });
    });
    const workflow = new DraftConfirmationWorkflow(
      async () => response(409),
      (state) => {
        displayedState = state;
      },
      reset,
    );

    await workflow.submit(toConfirmationInput(displayedDraft));

    expect(reset).not.toHaveBeenCalled();
    expect(displayedDraft).toEqual(originalDraft);
    expect(displayedDraft).toMatchObject({
      locationId: "20000000-0000-4000-8000-000000000001",
      baskets: expect.arrayContaining([{ id: "basket-ana", name: "Ana" }]),
      lines: [
        expect.objectContaining({
          quantity: 2,
          observation: "Sin picante",
          options: [{ id: "option-1", name: "Queso", priceAdjustment: 1 }],
          removableIngredients: [
            { id: "removal-1", name: "Sin cebolla", priceAdjustment: null },
          ],
        }),
      ],
    });
    expect(displayedState).toEqual({
      status: "error",
      message:
        "La ubicación o el menú cambió. Revisa la orden e inténtalo de nuevo.",
    });
    expect(
      confirmationActionState(
        displayedState as Parameters<typeof confirmationActionState>[0],
        toConfirmationInput(displayedDraft),
      ),
    ).toEqual({ disabled: false, label: "Confirmar orden" });
  });

  it("retains the draft and presents retry-safe feedback when the network rejects", async () => {
    const originalDraft = draft();
    let displayedDraft = originalDraft;
    let displayedState: unknown = { status: "idle" };
    const reset = vi.fn(() => {
      displayedDraft = draftReducer(displayedDraft, { type: "clear" });
    });
    const workflow = new DraftConfirmationWorkflow(
      async () => Promise.reject(new Error("offline")),
      (state) => {
        displayedState = state;
      },
      reset,
    );

    await workflow.submit(toConfirmationInput(displayedDraft));

    expect(reset).not.toHaveBeenCalled();
    expect(displayedDraft).toEqual(originalDraft);
    expect(displayedState).toEqual({
      status: "error",
      message:
        "No se pudo conectar para confirmar la orden. El borrador sigue disponible para reintentar.",
    });
  });
});
