import Link from "next/link";

import type { AssignableRole } from "@/application";
import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createRoleAdministrationService } from "@/lib/role-administration/server";

import { replaceUserRoles } from "./actions";

type PageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;

const feedback: Readonly<Record<string, string>> = {
  roles_updated: "Las funciones del empleado fueron actualizadas.",
  invalid_input: "Selecciona al menos una función válida.",
  operation_failed:
    "No se pudo actualizar la asignación. Inténtalo nuevamente.",
};

export default async function RoleAdministrationPage({
  searchParams,
}: PageProps) {
  await requireServerPermission(
    "administration.users.manage",
    "/administration/roles",
  );
  const result = await createRoleAdministrationService().read();
  const status = first((await searchParams).status);
  const statusIsError =
    status === "invalid_input" || status === "operation_failed";

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--brand-green)]">
            Administración
          </p>
          <h1 className="mt-2 text-3xl font-bold">Funciones y permisos</h1>
          <p className="mt-2 text-[var(--color-text-muted)]">
            Asigna funciones a empleados e inspecciona sus permisos heredados.
          </p>
        </div>
        <Link
          href="/administration/users"
          className="inline-flex min-h-12 items-center rounded-md border border-[var(--color-border-strong)] px-4 font-semibold"
        >
          Usuarios y acceso
        </Link>
      </header>

      {status && feedback[status] ? (
        <p
          role={statusIsError ? "alert" : "status"}
          className={`mt-5 rounded-md border p-4 text-sm font-semibold ${statusIsError ? "border-[var(--status-critical)] bg-[var(--status-critical-bg)] text-[var(--status-critical)]" : "border-[var(--color-border)] bg-[var(--status-new-bg)]"}`}
        >
          {feedback[status]}
        </p>
      ) : null}

      {!result.ok ? (
        <p role="alert" className="mt-6 text-[var(--status-critical)]">
          No se pudo cargar la administración de funciones.
        </p>
      ) : (
        <>
          <section className="mt-6">
            <h2 className="text-xl font-bold">Asignación por empleado</h2>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {result.value.employees.map((employee) => (
                <form
                  action={replaceUserRoles}
                  key={employee.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]"
                >
                  <input type="hidden" name="userId" value={employee.id} />
                  <p className="font-bold">{employee.displayName}</p>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    {employee.email}
                  </p>
                  <fieldset className="mt-4">
                    <legend className="text-sm font-semibold">
                      Funciones asignadas
                    </legend>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {result.value.roles.map((role) => (
                        <label
                          key={role.id}
                          className="flex min-h-12 items-center gap-3 rounded-md border border-[var(--color-border)] px-3"
                        >
                          <input
                            type="checkbox"
                            name="roleId"
                            value={role.id}
                            defaultChecked={employee.roleIds.includes(role.id)}
                            className="h-5 w-5 accent-[var(--brand-green)]"
                          />
                          <span>{roleLabel(role)}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <button
                    type="submit"
                    className="mt-4 min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white"
                  >
                    Guardar funciones
                  </button>
                </form>
              ))}
            </div>
          </section>

          <section className="mt-8">
            <h2 className="text-xl font-bold">
              Permisos heredados por función
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Los permisos se asignan únicamente mediante funciones; no se
              otorgan directamente a empleados.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              {result.value.roles.map((role) => (
                <article
                  key={role.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
                >
                  <h3 className="font-bold">{roleLabel(role)}</h3>
                  <ul className="mt-3 space-y-2 text-sm">
                    {role.permissions.map((permission) => (
                      <li
                        key={permission.code}
                        className="rounded-md bg-[var(--color-surface-muted)] p-3"
                      >
                        <span className="font-semibold">
                          {permissionLabel(permission.code)}
                        </span>
                        <span className="mt-1 block font-mono text-xs text-[var(--color-text-muted)]">
                          {permission.code}
                        </span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function roleLabel(role: Pick<AssignableRole, "code" | "name">) {
  const labels: Readonly<Record<string, string>> = {
    administrator: "Administrador",
    waiter: "Mesero",
    kitchen_personnel: "Personal de cocina",
  };
  return labels[role.code] ?? role.name;
}

function permissionLabel(code: string) {
  const labels: Readonly<Record<string, string>> = {
    "orders.create": "Crear órdenes",
    "orders.edit": "Editar órdenes",
    "orders.cancel": "Cancelar órdenes",
    "orders.view": "Ver órdenes",
    "kitchen.queue.view": "Ver cola de cocina",
    "kitchen.ready.mark": "Marcar como listo",
    "delivery.panel.view": "Ver panel de entregas",
    "delivery.on_the_way.mark": "Marcar en camino",
    "delivery.delivered.mark": "Marcar como entregado",
    "payments.register": "Registrar pagos",
    "payments.view": "Ver pagos",
    "payments.receipt.print": "Imprimir comprobantes",
    "payments.refund": "Reembolsar pagos (futuro)",
    "inventory.view": "Ver inventario",
    "inventory.purchases.register": "Registrar compras",
    "inventory.adjustments.register": "Registrar ajustes",
    "inventory.waste.register": "Registrar desperdicio",
    "production.batch.create": "Registrar producción",
    "production.recipes.edit": "Editar recetas",
    "production.history.view": "Ver historial de producción",
    "reports.view": "Ver reportes",
    "reports.export": "Exportar reportes",
    "administration.users.manage": "Administrar usuarios",
    "administration.roles.manage": "Administrar funciones",
    "administration.products.manage": "Administrar productos",
    "administration.categories.manage": "Administrar categorías",
    "administration.locations.manage": "Administrar ubicaciones",
    "administration.restaurant.configure": "Configurar restaurante",
    "administration.payment_methods.configure": "Configurar métodos de pago",
    "administration.printers.configure": "Configurar impresoras",
    "audit.log.view": "Ver auditoría",
  };
  return labels[code] ?? "Permiso adicional";
}
