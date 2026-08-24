"use server";

import { redirect } from "next/navigation";

import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createOperatingSettingsService } from "@/lib/operating-settings/server";

const PAGE_PATH = "/administration/settings";

export async function updateOperatingSettings(
  formData: FormData,
): Promise<never> {
  const actor = await requireServerPermission(
    "administration.restaurant.configure",
    PAGE_PATH,
  );
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const result = await createOperatingSettingsService().update(actor.userId, {
    restaurantId: text("restaurantId"),
    taxRateId: text("taxRateId"),
    restaurantName: text("restaurantName"),
    taxName: text("taxName"),
    taxRatePercent: text("taxRatePercent"),
    opensAt: text("opensAt"),
    closesAt: text("closesAt"),
    preparationWarningMinutes: text("preparationWarningMinutes"),
    preparationCriticalMinutes: text("preparationCriticalMinutes"),
    deliveryWarningMinutes: text("deliveryWarningMinutes"),
    deliveryCriticalMinutes: text("deliveryCriticalMinutes"),
    allowNegativeStock: formData.get("allowNegativeStock") === "true",
  });
  redirect(
    `${PAGE_PATH}?status=${result.ok ? "updated" : result.error.code.toLowerCase()}`,
  );
}
