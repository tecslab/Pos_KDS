import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireServerAuthorizationContext, list } = vi.hoisted(() => ({
  requireServerAuthorizationContext: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerAuthorizationContext,
}));
vi.mock("@/lib/inventory-purchase-registration/context", () => ({
  createInventoryPurchaseContextService: () => ({ list }),
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

async function page(status?: string) {
  return renderToStaticMarkup(
    await InventoryPage({
      searchParams: Promise.resolve(status ? { status } : {}),
    }),
  );
}

describe("InventoryPage", () => {
  beforeEach(() => {
    requireServerAuthorizationContext.mockReset();
    list.mockReset();
  });

  it("shows the permitted inventory workspace and confirmed purchase feedback", async () => {
    requireServerAuthorizationContext.mockResolvedValue({
      permissionCodes: ["inventory.purchases.register"],
    });
    list.mockResolvedValue({ ok: true, value: context });

    const markup = await page("registered");

    expect(requireServerAuthorizationContext).toHaveBeenCalledWith(
      "/inventory",
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Compra registrada. El inventario y el gasto");
  });

  it("presents a clear alert when the server rejects stale or invalid input", async () => {
    requireServerAuthorizationContext.mockResolvedValue({
      permissionCodes: ["inventory.purchases.register"],
    });
    list.mockResolvedValue({ ok: true, value: context });

    const markup = await page("inventory_item_unavailable");

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("El artículo seleccionado ya no está disponible");
  });

  it("visibly explains when a rejected purchase action redirects as unauthorized", async () => {
    requireServerAuthorizationContext.mockResolvedValue({
      permissionCodes: ["inventory.purchases.register"],
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
    requireServerAuthorizationContext.mockResolvedValue({
      permissionCodes: [
        "inventory.adjustments.register",
        "inventory.waste.register",
      ],
    });
    list.mockResolvedValue({ ok: true, value: context });

    const markup = await page();

    expect(markup).toContain("forms:true:true");
    expect(markup).not.toContain("Entrega de proveedor");
  });
});
