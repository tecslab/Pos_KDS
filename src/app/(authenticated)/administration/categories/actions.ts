"use server";

import { redirect } from "next/navigation";

import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createProductCategoryAdministrationService } from "@/lib/product-category-administration/server";

const PAGE_PATH = "/administration/categories";

export async function saveProductCategory(formData: FormData): Promise<never> {
  const actor = await requireServerPermission(
    "administration.categories.manage",
    PAGE_PATH,
  );
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const id = text("id");
  const result = await createProductCategoryAdministrationService().save(
    actor.userId,
    {
      id: id || undefined,
      restaurantId: text("restaurantId"),
      name: text("name"),
      displayOrder: text("displayOrder"),
      isActive: formData.get("isActive") === "true",
    },
  );

  redirect(
    `${PAGE_PATH}?status=${result.ok ? (id ? "updated" : "created") : result.error.code.toLowerCase()}`,
  );
}
