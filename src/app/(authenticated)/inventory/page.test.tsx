import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, list, listViews } = vi.hoisted(() => ({
  authorize: vi.fn(),
  list: vi.fn(),
  listViews: vi.fn(),
}));

vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerPermission: authorize,
}));
vi.mock("@/lib/inventory-purchase-registration/context", () => ({
  createInventoryPurchaseContextService: () => ({ list }),
}));
vi.mock("@/lib/inventory-views/server", () => ({
  createInventoryViewsService: () => ({ list: listViews }),
}));
vi.mock("./inventory-workspace", () => ({
  InventoryWorkspace: () => <p>inventory views</p>,
}));
vi.mock("./purchase-registration-form", () => ({
  PurchaseRegistrationForm: () => null,
}));
vi.mock("./adjustment-waste-registration-forms", () => ({
  AdjustmentWasteRegistrationForms: ({
    canRegisterAdjustment,
    canRegisterWaste,
  }: {
    canRegisterAdjustment: boolean;
    canRegisterWaste: boolean;
  }) => (
    <p>
      forms:{String(canRegisterAdjustment)}:{String(canRegisterWaste)}
    </p>
  ),
}));

import InventoryPage from "./page";

const context = Object.freeze({
  restaurants: Object.freeze([]),
  items: Object.freeze([]),
  expenseCategories: Object.freeze([]),
});
const views = Object.freeze({ balances: [], movements: [], activeAlerts: [] });

async function page(status?: string) {
  return renderToStaticMarkup(
    await InventoryPage({
      searchParams: Promise.resolve(status ? { status } : {}),
    }),
  );
}

describe("InventoryPage", () => {
  beforeEach(() => {
    authorize
      .mockReset()
      .mockResolvedValue({ permissionCodes: ["inventory.view"] });
    list.mockReset();
    listViews.mockReset().mockResolvedValue({ ok: true, value: views });
  });

  it("shows the permitted inventory workspace and confirmed purchase feedback", async () => {
    authorize.mockResolvedValue({
      permissionCodes: ["inventory.view", "inventory.purchases.register"],
    });
    list.mockResolvedValue({ ok: true, value: context });

    const markup = await page("registered");

    expect(authorize).toHaveBeenCalledWith("inventory.view", "/inventory");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Compra registrada. El inventario y el gasto");
  });

  it("presents a clear alert when the server rejects stale or invalid input", async () => {
    authorize.mockResolvedValue({
      permissionCodes: ["inventory.view", "inventory.purchases.register"],
    });
    list.mockResolvedValue({ ok: true, value: context });

    const markup = await page("inventory_item_unavailable");

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("El artículo seleccionado ya no está disponible");
  });

  it("visibly explains when a rejected purchase action redirects as unauthorized", async () => {
    authorize.mockResolvedValue({
      permissionCodes: ["inventory.view", "inventory.purchases.register"],
    });
    list.mockResolvedValue({ ok: true, value: context });

    const markup = await page("unauthorized");

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(
      "No tienes autorización para registrar compras de inventario",
    );
    expect(markup).toContain("Contacta a un administrador si necesitas acceso");
  });

  it("renders adjustment and waste forms from their independently granted permissions", async () => {
    authorize.mockResolvedValue({
      permissionCodes: [
        "inventory.view",
        "inventory.adjustments.register",
        "inventory.waste.register",
      ],
    });
    list.mockResolvedValue({ ok: true, value: context });

    const markup = await page();

    expect(markup).toContain("forms:true:true");
    expect(markup).not.toContain("Entrega de proveedor");
  });

  it("keeps registration permissions out of the read boundary", async () => {
    await page();

    expect(authorize).toHaveBeenCalledWith("inventory.view", "/inventory");
    expect(list).not.toHaveBeenCalled();
    expect(listViews).toHaveBeenCalledTimes(1);
  });

  it("shows a safe persisted-view failure without attempting a form mutation", async () => {
    listViews.mockResolvedValue({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });

    const markup = await page();

    expect(markup).toContain("No se pudo cargar el inventario");
    expect(markup).toContain('role="alert"');
  });
});
