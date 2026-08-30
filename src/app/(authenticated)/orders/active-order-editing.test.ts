import { describe, expect, it, vi } from "vitest";

import type {
  ActiveOrderDetail,
  PosOrderingContextProduct,
} from "@/application";

import {
  ActiveOrderSaveWorkflow,
  applyPendingOrderEdit,
  createAddedOrderLine,
  createPendingOrderEdit,
  modificationFailure,
  pendingOrderEditReducer,
  saveActionState,
  toModificationInput,
} from "./active-order-editing";

const orderId = "41000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const lineId = "43000000-0000-4000-8000-000000000001";
const snapshotId = "44000000-0000-4000-8000-000000000001";
const productVersionId = "45000000-0000-4000-8000-000000000001";
const secondProductVersionId = "45000000-0000-4000-8000-000000000002";
const optionId = "46000000-0000-4000-8000-000000000001";
const removalId = "47000000-0000-4000-8000-000000000001";

function order(
  status: ActiveOrderDetail["status"] = "PENDING",
): ActiveOrderDetail {
  return {
    id: orderId,
    restaurantId: "40000000-0000-4000-8000-000000000001",
    orderNumber: "ORD-44",
    serviceLocation: {
      id: "48000000-0000-4000-8000-000000000001",
      name: "Mesa 4",
      type: "TABLE",
    },
    assignedWaiter: {
      id: "49000000-0000-4000-8000-000000000001",
      displayName: "Ana",
    },
    status,
    notes: null,
    totalAmount: "12.00",
    paidAmount: "0.00",
    outstandingBalance: "12.00",
    createdAt: "2026-08-29T11:50:00.000Z",
    updatedAt: "2026-08-29T12:00:00.000Z",
    readyAt: null,
    onTheWayAt: null,
    deliveredAt: null,
    paidAt: null,
    baskets: [
      {
        id: basketId,
        status: "PENDING",
        totalAmount: "12.00",
        paidAmount: "0.00",
        outstandingBalance: "12.00",
        lineCount: 1,
        createdAt: "2026-08-29T11:50:00.000Z",
        paidAt: null,
        lines: [
          {
            id: lineId,
            currentSnapshotId: snapshotId,
            createdAt: "2026-08-29T11:50:00.000Z",
            currentSnapshot: {
              id: snapshotId,
              revisionNumber: 1,
              productVersionId,
              productName: "Taco",
              quantity: 2,
              baseUnitPrice: "5.00",
              finalUnitPrice: "6.00",
              lineTotal: "12.00",
              taxCode: "IVA",
              taxName: "IVA",
              taxRate: "0.15",
              priceIncludesTax: true,
              selectedOptions: [
                { id: optionId, name: "Queso", priceAdjustment: "1.00" },
              ],
              removedIngredients: [
                {
                  id: removalId,
                  name: "Sin cebolla",
                  priceAdjustment: null,
                },
              ],
              observations: "Sin picante",
              createdAt: "2026-08-29T11:50:00.000Z",
            },
            snapshots: [],
          },
        ],
      },
    ],
  };
}

const product: PosOrderingContextProduct = {
  id: "product-2",
  productVersionId: secondProductVersionId,
  versionNumber: 1,
  name: "Burrito",
  printerAlias: "COCINA",
  displayOrder: 1,
  unitPrice: 8,
  tax: {
    taxRateId: "tax-1",
    code: "IVA",
    name: "IVA",
    rate: 0.15,
    priceIncludesTax: true,
  },
  options: [],
  removableIngredients: [],
};

function response(status: number, body: unknown = {}) {
  return { status, json: async () => body };
}

describe("active-order editing state", () => {
  it("never creates editable state for a non-pending order", () => {
    expect(createPendingOrderEdit(order("READY"))).toBeNull();
    expect(createPendingOrderEdit(order("DELIVERED"))).toBeNull();
  });

  it("emits only changed replace fields with server concurrency tokens", () => {
    const initial = createPendingOrderEdit(order());
    expect(initial).not.toBeNull();
    const quantityChanged = pendingOrderEditReducer(initial!, {
      type: "set-quantity",
      key: lineId,
      quantity: 3,
    });
    const changed = pendingOrderEditReducer(quantityChanged, {
      type: "set-observations",
      key: lineId,
      observations: "  Sin sal  ",
    });

    expect(toModificationInput(changed)).toEqual({
      orderId,
      expectedUpdatedAt: "2026-08-29T12:00:00.000Z",
      operations: [
        {
          kind: "replace",
          lineId,
          expectedCurrentSnapshotId: snapshotId,
          quantity: 3,
          optionIds: [optionId],
          removableIngredientIds: [removalId],
          observations: "Sin sal",
        },
      ],
    });
    expect(toModificationInput(initial!)).toBeNull();
  });

  it("maps local additions and persisted removals to the supported public operations", () => {
    const initial = createPendingOrderEdit(order())!;
    const withAddition = pendingOrderEditReducer(initial, {
      type: "add",
      line: createAddedOrderLine({
        key: "active-edit-new-1",
        basketId,
        product,
        quantity: 2,
        optionIds: [],
        removableIngredientIds: [],
        observations: "  Cortado  ",
      }),
    });
    const changed = pendingOrderEditReducer(withAddition, {
      type: "remove",
      key: lineId,
    });

    expect(toModificationInput(changed)?.operations).toEqual([
      {
        kind: "remove",
        lineId,
        expectedCurrentSnapshotId: snapshotId,
      },
      {
        kind: "add",
        basketId,
        clientCorrelationId: "active-edit-new-1",
        productVersionId: secondProductVersionId,
        quantity: 2,
        optionIds: [],
        removableIngredientIds: [],
        observations: "Cortado",
      },
    ]);
  });

  it("keeps product removal reversible and drops an unsaved added product locally", () => {
    const initial = createPendingOrderEdit(order())!;
    const removed = pendingOrderEditReducer(initial, {
      type: "remove",
      key: lineId,
    });
    const restored = pendingOrderEditReducer(removed, {
      type: "restore",
      key: lineId,
    });
    expect(toModificationInput(restored)).toBeNull();

    const added = pendingOrderEditReducer(initial, {
      type: "add",
      line: createAddedOrderLine({
        key: "active-edit-new-2",
        basketId,
        product,
        quantity: 1,
        optionIds: [],
        removableIngredientIds: [],
        observations: "",
      }),
    });
    const dropped = pendingOrderEditReducer(added, {
      type: "remove",
      key: "active-edit-new-2",
    });
    expect(toModificationInput(dropped)).toBeNull();
  });
});

describe("active-order save workflow", () => {
  it("prevents duplicate saves and reports the server total after a 200", async () => {
    let resolveResponse: (value: ReturnType<typeof response>) => void = () => {
      throw new Error("response was not requested");
    };
    const transport = vi.fn(
      () =>
        new Promise<ReturnType<typeof response>>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const states: unknown[] = [];
    const persisted = vi.fn();
    const workflow = new ActiveOrderSaveWorkflow(
      transport,
      (state) => states.push(state),
      persisted,
    );
    const edit = pendingOrderEditReducer(createPendingOrderEdit(order())!, {
      type: "set-quantity",
      key: lineId,
      quantity: 3,
    });
    const input = toModificationInput(edit);

    const first = workflow.submit(input);
    const second = workflow.submit(input);
    expect(transport).toHaveBeenCalledOnce();
    expect(saveActionState({ status: "pending" }, input)).toEqual({
      disabled: true,
      label: "Guardando cambios…",
    });

    resolveResponse(
      response(200, {
        orderId,
        status: "PENDING",
        totalAmount: "18.00",
        updatedAt: "2026-08-29T12:01:00.000Z",
      }),
    );
    await Promise.all([first, second]);

    expect(states).toEqual([
      { status: "pending" },
      { status: "success", totalAmount: "18.00" },
    ]);
    expect(
      saveActionState({ status: "success", totalAmount: "18.00" }, input),
    ).toMatchObject({ disabled: true });
    expect(persisted).toHaveBeenCalledWith(
      {
        totalAmount: "18.00",
        updatedAt: "2026-08-29T12:01:00.000Z",
      },
      input,
    );
  });

  it("retains recovery intent for conflicts, forbidden states, inventory, and network errors", async () => {
    expect(modificationFailure(409, "STALE_ORDER")).toMatchObject({
      recovery: "reload",
    });
    expect(
      saveActionState(
        modificationFailure(409, "STALE_ORDER"),
        toModificationInput(
          pendingOrderEditReducer(createPendingOrderEdit(order())!, {
            type: "set-quantity",
            key: lineId,
            quantity: 3,
          }),
        ),
      ),
    ).toMatchObject({ disabled: true });
    expect(modificationFailure(409, "ORDER_NOT_PENDING")).toMatchObject({
      recovery: "blocked",
    });
    expect(modificationFailure(403, "UNAUTHORIZED")).toMatchObject({
      recovery: "blocked",
    });
    expect(modificationFailure(409, "INSUFFICIENT_INVENTORY")).toMatchObject({
      recovery: "retry",
    });

    const states: unknown[] = [];
    const workflow = new ActiveOrderSaveWorkflow(
      async () => Promise.reject(new Error("offline")),
      (state) => states.push(state),
      vi.fn(),
    );
    const edit = pendingOrderEditReducer(createPendingOrderEdit(order())!, {
      type: "set-quantity",
      key: lineId,
      quantity: 3,
    });
    await workflow.submit(toModificationInput(edit));
    expect(states.at(-1)).toMatchObject({
      status: "error",
      recovery: "retry",
    });
  });

  it.each([
    [403, "UNAUTHORIZED", "blocked"],
    [409, "ORDER_NOT_PENDING", "blocked"],
    [409, "STALE_ORDER", "reload"],
    [409, "STALE_CONFIGURATION", "reload"],
  ] as const)(
    "does not resend after %s %s until an explicit successful reload resets the workflow",
    async (status, code, recovery) => {
      const transport = vi
        .fn()
        .mockResolvedValueOnce(response(status, { error: { code } }))
        .mockResolvedValueOnce(
          response(200, {
            totalAmount: "18.00",
            updatedAt: "2026-08-29T12:01:00.000Z",
          }),
        );
      let state: unknown = { status: "idle" };
      const workflow = new ActiveOrderSaveWorkflow(
        transport,
        (nextState) => {
          state = nextState;
        },
        vi.fn(),
      );
      const changed = pendingOrderEditReducer(
        createPendingOrderEdit(order())!,
        { type: "set-quantity", key: lineId, quantity: 3 },
      );
      const input = toModificationInput(changed);

      await workflow.submit(input);
      expect(state).toMatchObject({ status: "error", recovery });

      const editedAgain = applyPendingOrderEdit(
        changed,
        { type: "set-quantity", key: lineId, quantity: 4 },
        state as Parameters<typeof applyPendingOrderEdit>[2],
      );
      expect(editedAgain).toBe(changed);
      await workflow.submit(toModificationInput(editedAgain));
      expect(transport).toHaveBeenCalledOnce();

      workflow.resetAfterReload();
      await workflow.submit(toModificationInput(editedAgain));
      expect(transport).toHaveBeenCalledTimes(2);
    },
  );

  it("treats a malformed 200 body as persisted and never offers a retry", async () => {
    const states: unknown[] = [];
    const persisted = vi.fn();
    const workflow = new ActiveOrderSaveWorkflow(
      async () => response(200, "unexpected"),
      (state) => states.push(state),
      persisted,
    );
    const edit = pendingOrderEditReducer(createPendingOrderEdit(order())!, {
      type: "set-quantity",
      key: lineId,
      quantity: 3,
    });

    await workflow.submit(toModificationInput(edit));

    expect(states.at(-1)).toEqual({
      status: "success",
      totalAmount: null,
    });
    expect(persisted).toHaveBeenCalledOnce();
  });
});
