"use server";

import { redirect } from "next/navigation";

import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createInventoryItemAdministrationService } from "@/lib/inventory-item-administration/server";

const PAGE_PATH = "/administration/inventory-items";

export async function saveInventoryItem(formData: FormData): Promise<never> {
  const actor = await requireServerPermission(
    "administration.inventory.manage",
    PAGE_PATH,
  );
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const id = text("id");
  const result = await createInventoryItemAdministrationService().save(
    actor.userId,
    {
      id: id || undefined,
      restaurantId: text("restaurantId"),
      name: text("name"),
      type: text("type"),
      unitOfMeasure: text("unitOfMeasure"),
      minimumStockLevel: text("minimumStockLevel"),
      isActive: formData.get("isActive") === "true",
    },
  );

  redirect(
    `${PAGE_PATH}?status=${result.ok ? (id ? "updated" : "created") : result.error.code.toLowerCase()}`,
  );
}
