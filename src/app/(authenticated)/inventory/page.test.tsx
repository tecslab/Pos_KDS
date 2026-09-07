import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireServerPermission, list } = vi.hoisted(() => ({
  requireServerPermission: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerPermission,
}));
vi.mock("@/lib/inventory-purchase-registration/context", () => ({
  createInventoryPurchaseContextService: () => ({ list }),
}));
vi.mock("./purchase-registration-form", () => ({
  PurchaseRegistrationForm: () => null,
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
    requireServerPermission.mockReset();
    list.mockReset();
  });

  it("guards the purchase workspace and presents confirmed registration feedback", async () => {
    requireServerPermission.mockResolvedValue({});
    list.mockResolvedValue({ ok: true, value: context });

    const markup = await page("registered");

    expect(requireServerPermission).toHaveBeenCalledWith(
      "inventory.purchases.register",
      "/inventory",
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Compra registrada. El inventario y el gasto");
  });

  it("presents a clear alert when the server rejects stale or invalid input", async () => {
    requireServerPermission.mockResolvedValue({});
    list.mockResolvedValue({ ok: true, value: context });

    const markup = await page("inventory_item_unavailable");

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("El artículo seleccionado ya no está disponible");
  });

  it("visibly explains when a rejected purchase action redirects as unauthorized", async () => {
    requireServerPermission.mockResolvedValue({});
    list.mockResolvedValue({ ok: true, value: context });

    const markup = await page("unauthorized");

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(
      "No tienes autorización para registrar compras de inventario",
    );
    expect(markup).toContain("Contacta a un administrador si necesitas acceso");
  });
});
