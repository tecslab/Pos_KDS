"use server";

import { redirect } from "next/navigation";

import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createProductAdministrationService } from "@/lib/product-administration/server";

const PAGE_PATH = "/administration/products";

export async function saveProduct(formData: FormData): Promise<never> {
  const actor = await requireServerPermission(
    "administration.products.manage",
    PAGE_PATH,
  );
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const id = text("id");
  const result = await createProductAdministrationService().save(actor.userId, {
    id: id || undefined,
    restaurantId: text("restaurantId"),
    categoryId: text("categoryId"),
    displayOrder: text("displayOrder"),
    isActive: formData.get("isActive") === "true",
    name: text("name"),
    unitPrice: text("unitPrice"),
    printerAlias: text("printerAlias"),
    taxRateId: text("taxRateId"),
    priceIncludesTax: formData.get("priceIncludesTax") === "true",
    recipeId: text("recipeId") || undefined,
    resaleInventoryItemId: text("resaleInventoryItemId") || undefined,
    optionLines: text("optionLines"),
    removableIngredientLines: text("removableIngredientLines"),
  });

  redirect(
    `${PAGE_PATH}?status=${result.ok ? (id ? "updated" : "created") : result.error.code.toLowerCase()}`,
  );
}
