"use server";

import { redirect } from "next/navigation";

import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createRecipeAdministrationService } from "@/lib/recipe-administration/server";

const PAGE_PATH = "/production";

export async function saveRecipe(formData: FormData): Promise<never> {
  const actor = await requireServerPermission(
    "production.recipes.edit",
    PAGE_PATH,
  );
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const itemIds = formData.getAll("ingredientInventoryItemId");
  const quantities = formData.getAll("ingredientRequiredQuantity");
  const id = text("id");
  const result = await createRecipeAdministrationService().save(actor.userId, {
    id: id || undefined,
    restaurantId: text("restaurantId"),
    productId: text("productId"),
    outputInventoryItemId: text("outputInventoryItemId"),
    name: text("name"),
    isActive: formData.get("isActive") === "true",
    producedQuantity: text("producedQuantity"),
    ingredients: itemIds.map((value, index) => ({
      inventoryItemId: typeof value === "string" ? value : "",
      requiredQuantity:
        typeof quantities[index] === "string" ? quantities[index] : "",
    })),
  });
  redirect(
    `${PAGE_PATH}?status=${result.ok ? (id ? "version_created" : "created") : result.error.code.toLowerCase()}`,
  );
}
