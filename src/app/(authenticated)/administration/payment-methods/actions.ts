"use server";
import { redirect } from "next/navigation";
import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createPaymentMethodAdministrationService } from "@/lib/payment-method-administration/server";

const PAGE_PATH = "/administration/payment-methods";
export async function savePaymentMethod(formData: FormData): Promise<never> {
  const actor = await requireServerPermission(
    "administration.payment_methods.configure",
    PAGE_PATH,
  );
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const id = text("id");
  const result = await createPaymentMethodAdministrationService().save(
    actor.userId,
    {
      id: id || undefined,
      restaurantId: text("restaurantId"),
      code: text("code"),
      name: text("name"),
      displayOrder: text("displayOrder"),
      isActive: formData.get("isActive") === "true",
      isBankTransfer: formData.get("isBankTransfer") === "true",
      bankName: text("bankName"),
      accountHolder: text("accountHolder"),
      accountNumber: text("accountNumber"),
      receiptHeader: text("receiptHeader"),
      receiptFooter: text("receiptFooter"),
    },
  );
  redirect(
    `${PAGE_PATH}?status=${result.ok ? (id ? "updated" : "created") : result.error.code.toLowerCase()}`,
  );
}
