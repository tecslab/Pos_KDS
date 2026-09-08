"use server";

import { redirect } from "next/navigation";

import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createInventoryAdjustmentWasteRegistrationService } from "@/lib/inventory-adjustment-waste-registration/server";
import { createInventoryPurchaseRegistrationService } from "@/lib/inventory-purchase-registration/server";

const PAGE_PATH = "/inventory";

export type InventoryMovementActionState =
  | Readonly<{
      status: "success";
      operation: "ADJUSTMENT" | "WASTE";
      newBalance: string;
      unitOfMeasure: string;
    }>
  | Readonly<{ status: "error"; message: string }>;

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

export async function registerInventoryAdjustment(
  formData: FormData,
): Promise<InventoryMovementActionState> {
  return registerInventoryMovement("ADJUSTMENT", formData);
}

export async function registerInventoryWaste(
  formData: FormData,
): Promise<InventoryMovementActionState> {
  return registerInventoryMovement("WASTE", formData);
}

async function registerInventoryMovement(
  operation: "ADJUSTMENT" | "WASTE",
  formData: FormData,
): Promise<InventoryMovementActionState> {
  const permission =
    operation === "ADJUSTMENT"
      ? "inventory.adjustments.register"
      : "inventory.waste.register";
  const actor = await requireServerPermission(permission, PAGE_PATH);
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const result =
    await createInventoryAdjustmentWasteRegistrationService().register(
      actor.userId,
      {
        restaurantId: text("restaurantId"),
        inventoryItemId: text("inventoryItemId"),
        operation,
        quantity: text("quantity"),
        reason: text("reason"),
      },
    );

  if (result.ok) {
    return Object.freeze({
      status: "success" as const,
      operation: result.value.operation,
      newBalance: result.value.newBalance,
      unitOfMeasure: result.value.unitOfMeasure,
    });
  }

  return Object.freeze({
    status: "error" as const,
    message: movementFailureMessage(result.error.code),
  });
}

function movementFailureMessage(code: string): string {
  switch (code) {
    case "INVALID_MOVEMENT":
      return "Revisa el artículo, la cantidad y el motivo antes de registrar el movimiento.";
    case "RESTAURANT_UNAVAILABLE":
      return "El restaurante seleccionado ya no está disponible. Actualiza la página.";
    case "INVENTORY_ITEM_UNAVAILABLE":
      return "El artículo seleccionado ya no está disponible. Actualiza la página.";
    case "NEGATIVE_STOCK_DISALLOWED":
      return "No se puede registrar el movimiento porque dejaría el inventario con saldo negativo.";
    case "UNAUTHORIZED":
      return "No tienes autorización para registrar este movimiento de inventario.";
    default:
      return "No se pudo registrar el movimiento de inventario. Inténtalo nuevamente.";
  }
}
