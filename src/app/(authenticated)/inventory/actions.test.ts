import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireServerPermission, register, redirect } = vi.hoisted(() => ({
  requireServerPermission: vi.fn(),
  register: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerPermission,
}));
vi.mock("@/lib/inventory-purchase-registration/server", () => ({
  createInventoryPurchaseRegistrationService: () => ({ register }),
}));

import { registerInventoryPurchase } from "./actions";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const categoryId = "31000000-0000-4000-8000-000000000001";
const itemId = "32000000-0000-4000-8000-000000000001";

function formData() {
  const data = new FormData();
  data.set("restaurantId", restaurantId);
  data.set("expenseCategoryId", categoryId);
  data.set("inventoryItemId", itemId);
  data.set("quantity", "2.500");
  data.set("unitPrice", "4.25");
  data.set("supplierName", "Mercado Central");
  data.set("comments", "Entrega de mañana");
  return data;
}

describe("registerInventoryPurchase", () => {
  beforeEach(() => {
    requireServerPermission.mockReset();
    register.mockReset();
    redirect.mockClear();
  });

  it("authorizes then submits the selected single purchase line to T-058", async () => {
    requireServerPermission.mockResolvedValue({ userId: actorId });
    register.mockResolvedValue({ ok: true, value: {} });

    await expect(registerInventoryPurchase(formData())).rejects.toThrow(
      "redirect:/inventory?status=registered",
    );

    expect(requireServerPermission).toHaveBeenCalledWith(
      "inventory.purchases.register",
      "/inventory",
    );
    expect(register).toHaveBeenCalledWith(actorId, {
      restaurantId,
      expenseCategoryId: categoryId,
      supplierName: "Mercado Central",
      comments: "Entrega de mañana",
      lines: [
        { inventoryItemId: itemId, quantity: "2.500", unitPrice: "4.25" },
      ],
    });
  });

  it("does not reach the registration service when server authorization rejects", async () => {
    requireServerPermission.mockRejectedValue(new Error("Forbidden"));

    await expect(registerInventoryPurchase(formData())).rejects.toThrow(
      "Forbidden",
    );
    expect(register).not.toHaveBeenCalled();
  });

  it("redirects an unauthorized service result to the visible authorization feedback", async () => {
    requireServerPermission.mockResolvedValue({ userId: actorId });
    register.mockResolvedValue({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });

    await expect(registerInventoryPurchase(formData())).rejects.toThrow(
      "redirect:/inventory?status=unauthorized",
    );
  });
});
