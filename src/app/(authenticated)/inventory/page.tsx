import { unauthorizedError } from "../../../domain";
import { requireServerAuthorizationContext } from "@/lib/auth/server-authorization";
import { createInventoryPurchaseContextService } from "@/lib/inventory-purchase-registration/context";

import { AdjustmentWasteRegistrationForms } from "./adjustment-waste-registration-forms";
import { PurchaseRegistrationForm } from "./purchase-registration-form";

type PageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;

const feedback: Readonly<Record<string, string>> = {
  registered:
    "Compra registrada. El inventario y el gasto fueron actualizados.",
  invalid_purchase:
    "Revisa el artículo, la cantidad, el costo y los campos obligatorios.",
  restaurant_unavailable:
    "El restaurante seleccionado ya no está disponible. Actualiza la página.",
  inventory_item_unavailable:
    "El artículo seleccionado ya no está disponible. Actualiza la página.",
  expense_category_unavailable:
    "La categoría de gasto ya no está disponible. Actualiza la página.",
  unauthorized:
    "No tienes autorización para registrar compras de inventario. Contacta a un administrador si necesitas acceso.",
  operation_failed:
    "No se pudo registrar la compra. Actualiza la página e inténtalo nuevamente.",
};

export default async function InventoryPage({ searchParams }: PageProps) {
  const [authorization, context, params] = await Promise.all([
    requireServerAuthorizationContext("/inventory"),
    createInventoryPurchaseContextService().list(),
    searchParams,
  ]);
  const permissions = new Set(authorization.permissionCodes);
  const canRegisterPurchase = permissions.has("inventory.purchases.register");
  const canRegisterAdjustment = permissions.has(
    "inventory.adjustments.register",
  );
  const canRegisterWaste = permissions.has("inventory.waste.register");
  if (!canRegisterPurchase && !canRegisterAdjustment && !canRegisterWaste) {
    throw unauthorizedError();
  }
  const rawStatus = params.status;
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
  const isError = status !== "registered";

  return (
    <div>
      <header>
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Inventario
        </p>
        <h1 className="mt-2 text-3xl font-bold">Movimientos de inventario</h1>
        <p className="mt-2 max-w-3xl text-[var(--color-text-muted)]">
          Registra compras, ajustes físicos y desperdicios. Cada movimiento
          conserva su motivo, responsable y saldo resultante.
        </p>
      </header>

      {status && feedback[status] ? (
        <p
          role={isError ? "alert" : "status"}
          className={`mt-5 rounded-md border p-4 text-sm font-semibold ${isError ? "border-[var(--status-critical)] bg-[var(--status-critical-bg)] text-[var(--status-critical)]" : "border-[var(--color-border)] bg-[var(--status-new-bg)] text-[var(--status-new)]"}`}
        >
          {feedback[status]}
        </p>
      ) : null}

      {!context.ok ? (
        <p role="alert" className="mt-6 text-[var(--status-critical)]">
          No se pudo cargar la información necesaria para registrar movimientos
          de inventario. Actualiza la página e inténtalo nuevamente.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {canRegisterPurchase ? (
            <section
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]"
              aria-labelledby="purchase-form-title"
            >
              <h2 id="purchase-form-title" className="text-xl font-bold">
                Entrega de proveedor
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                La unidad se toma del artículo seleccionado y no se puede
                cambiar aquí.
              </p>
              <PurchaseRegistrationForm {...context.value} />
            </section>
          ) : null}
          {canRegisterAdjustment || canRegisterWaste ? (
            <AdjustmentWasteRegistrationForms
              restaurants={context.value.restaurants}
              items={context.value.items}
              canRegisterAdjustment={canRegisterAdjustment}
              canRegisterWaste={canRegisterWaste}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
