"use server";

import { redirect } from "next/navigation";

import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createInventoryPurchaseRegistrationService } from "@/lib/inventory-purchase-registration/server";

const PAGE_PATH = "/inventory";

export async function registerInventoryPurchase(
  formData: FormData,
): Promise<never> {
  const actor = await requireServerPermission(
    "inventory.purchases.register",
    PAGE_PATH,
  );
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const result = await createInventoryPurchaseRegistrationService().register(
    actor.userId,
    {
      restaurantId: text("restaurantId"),
      expenseCategoryId: text("expenseCategoryId"),
      supplierName: text("supplierName"),
      comments: text("comments"),
      lines: [
        {
          inventoryItemId: text("inventoryItemId"),
          quantity: text("quantity"),
          unitPrice: text("unitPrice"),
        },
      ],
    },
  );

  redirect(
    `${PAGE_PATH}?status=${result.ok ? "registered" : result.error.code.toLowerCase()}`,
  );
}
