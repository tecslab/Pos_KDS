import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createPaymentMethodAdministrationService } from "@/lib/payment-method-administration/server";
import { createPaymentQueryService } from "@/lib/payment-queries/server";

import {
  PaymentWorkspace,
  type ConfiguredPaymentMethod,
} from "./payment-workspace";

export default async function PaymentsPage() {
  const context = await requireServerPermission("payments.view", "/payments");
  const data = await loadPaymentPageData();

  if (data === null) return <PaymentLoadFailure />;

  return (
    <PaymentWorkspace
      initialOrders={data.orders}
      methods={data.methods}
      canRegister={context.permissionCodes.includes("payments.register")}
      canAuthorizeOverage={context.permissionCodes.includes(
        "payments.overage.authorize",
      )}
    />
  );
}

async function loadPaymentPageData() {
  try {
    const [orders, configuredMethods] = await Promise.all([
      createPaymentQueryService().list({}),
      createPaymentMethodAdministrationService().list(),
    ]);
    if (!orders.ok || !configuredMethods.ok) return null;

    const methods: ConfiguredPaymentMethod[] = configuredMethods.value
      .filter((method) => method.isActive)
      .map((method) =>
        Object.freeze({
          id: method.id,
          restaurantId: method.restaurantId,
          code: method.code,
          name: method.name,
          displayOrder: method.displayOrder,
        }),
      );
    return Object.freeze({
      orders: orders.value,
      methods: Object.freeze(methods),
    });
  } catch {
    return null;
  }
}

function PaymentLoadFailure() {
  return (
    <section
      role="alert"
      className="rounded-lg border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-6 text-[var(--status-critical)]"
    >
      <h1 className="text-2xl font-bold">No se pudieron cargar los pagos</h1>
      <p className="mt-2">
        Actualiza la página para volver a consultar las cuentas y los métodos
        configurados.
      </p>
    </section>
  );
}
