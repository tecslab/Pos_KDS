// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/supabase", () => ({
  createBrowserSupabaseClient: () => {
    throw new Error("Realtime is unavailable in this browser test.");
  },
}));
vi.mock("../../../infrastructure/realtime", () => ({
  SupabaseRealtimeSubscriber: class SupabaseRealtimeSubscriber {},
}));

import { InventoryWorkspace } from "./inventory-workspace";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const restaurantId = "30000000-0000-4000-8000-000000000001";
const itemId = "31000000-0000-4000-8000-000000000001";
function views(balance = "1.000") {
  return {
    balances: [
      {
        restaurantId,
        restaurantName: "Centro",
        inventoryItemId: itemId,
        inventoryItemName: "Tomate",
        inventoryItemType: "INGREDIENT",
        unitOfMeasure: "kg",
        minimumStockLevel: "2.000",
        currentBalance: balance,
        isBelowMinimum: true,
      },
    ],
    movements: [],
    activeAlerts: [],
  } as const;
}
function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("InventoryWorkspace", () => {
  it("renders persisted balances and refreshes them through the protected API without trusting event payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(views("1.000")))
      .mockResolvedValue(response(views("3.000")));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(<InventoryWorkspace initialViews={views()} />),
    );

    expect(container.textContent).toContain("1.000 kg");
    const button = [...container.querySelectorAll("button")].find(
      (entry) => entry.textContent === "Actualizar inventario",
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    await act(async () =>
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await vi.waitFor(() => expect(container.textContent).toContain("3.000 kg"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/inventory",
      expect.objectContaining({ method: "GET" }),
    );
    await act(async () => root.unmount());
  });

  it("keeps the last persisted view visible and announces a failed refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ error: {} }, 500)),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(<InventoryWorkspace initialViews={views()} />),
    );
    const button = [...container.querySelectorAll("button")].find(
      (entry) => entry.textContent === "Actualizar inventario",
    );
    await act(async () =>
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "No se pudo actualizar el inventario",
      ),
    );
    expect(container.textContent).toContain("1.000 kg");
    await act(async () => root.unmount());
  });
});
