"use server";

import { redirect } from "next/navigation";

import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createProductionBatchCompletionService } from "@/lib/production-batch-completion/server";
import { createRecipeAdministrationService } from "@/lib/recipe-administration/server";

const PAGE_PATH = "/production";

export type CompleteProductionBatchActionState =
  | Readonly<{
      status: "success";
      producedQuantity: string;
      unitOfMeasure: string;
    }>
  | Readonly<{ status: "error"; message: string }>;

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

export async function completeProductionBatch(
  formData: FormData,
): Promise<CompleteProductionBatchActionState> {
  const actor = await requireServerPermission(
    "production.batch.create",
    PAGE_PATH,
  );
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const result = await createProductionBatchCompletionService().complete(
    actor.userId,
    {
      restaurantId: text("restaurantId"),
      recipeVersionId: text("recipeVersionId"),
      producedQuantity: text("producedQuantity"),
      notes: text("notes"),
    },
  );
  if (result.ok) {
    return Object.freeze({
      status: "success" as const,
      producedQuantity: result.value.producedQuantity,
      unitOfMeasure: result.value.unitOfMeasure,
    });
  }
  return Object.freeze({
    status: "error" as const,
    message: productionFailureMessage(result.error.code),
  });
}

function productionFailureMessage(code: string): string {
  switch (code) {
    case "INVALID_BATCH":
      return "Revisa la receta, la cantidad producida y las notas antes de registrar la producción.";
    case "RESTAURANT_UNAVAILABLE":
      return "El restaurante seleccionado ya no está disponible. Actualiza la página.";
    case "RECIPE_VERSION_UNAVAILABLE":
      return "La versión de receta seleccionada ya no está disponible. Actualiza la página y vuelve a elegirla.";
    case "INVENTORY_ITEM_UNAVAILABLE":
      return "Un artículo de la receta ya no está disponible. Actualiza la página antes de registrar la producción.";
    case "INSUFFICIENT_INVENTORY":
      return "No hay ingredientes suficientes para completar esta producción. Revisa los saldos y registra existencias antes de intentarlo nuevamente.";
    case "UNAUTHORIZED":
      return "No tienes autorización para registrar producción.";
    default:
      return "No se pudo completar la producción. Inténtalo nuevamente.";
  }
}
