"use server";

import { redirect } from "next/navigation";

import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createServiceLocationAdministrationService } from "@/lib/service-location-administration/server";

const PAGE_PATH = "/administration/locations";

export async function saveServiceLocation(formData: FormData): Promise<never> {
  const actor = await requireServerPermission(
    "administration.locations.manage",
    PAGE_PATH,
  );
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const id = text("id");
  const result = await createServiceLocationAdministrationService().save(
    actor.userId,
    {
      id: id || undefined,
      restaurantId: text("restaurantId"),
      name: text("name"),
      type: text("type"),
      displayOrder: text("displayOrder"),
      isActive: formData.get("isActive") === "true",
      allowsMultipleActiveOrders:
        formData.get("allowsMultipleActiveOrders") === "true",
    },
  );
  redirect(
    `${PAGE_PATH}?status=${result.ok ? (id ? "updated" : "created") : result.error.code.toLowerCase()}`,
  );
}
