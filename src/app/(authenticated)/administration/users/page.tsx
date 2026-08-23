import Link from "next/link";

import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createUserAdministrationService } from "@/lib/user-administration/server";

import { inviteUser, requestPasswordReset, setUserActive } from "./actions";

type PageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;

const feedback: Readonly<Record<string, string>> = {
  invited: "La invitación fue enviada.",
  activated: "El acceso del empleado fue activado.",
  deactivated: "El acceso del empleado fue desactivado.",
  reset_sent: "Se envió el correo para restablecer el acceso.",
  invalid_input: "Revisa la información ingresada.",
  operation_failed: "No se pudo completar la operación. Inténtalo nuevamente.",
};

export default async function UserAdministrationPage({
  searchParams,
}: PageProps) {
  await requireServerPermission(
    "administration.users.manage",
    "/administration/users",
  );
  const result = await createUserAdministrationService().list();
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
          <h1 className="mt-2 text-3xl font-bold">Usuarios y acceso</h1>
          <p className="mt-2 text-[var(--color-text-muted)]">
            Invita empleados y administra su acceso. Las funciones y permisos se
            asignan por separado.
          </p>
        </div>
        <Link
          href="/administration/roles"
          className="inline-flex min-h-12 items-center rounded-md border border-[var(--color-border-strong)] px-4 font-semibold"
        >
          Funciones y permisos
        </Link>
      </header>

      {status && feedback[status] ? (
        <p
          role={statusIsError ? "alert" : "status"}
          className={`mt-5 rounded-md border p-4 text-sm font-semibold ${statusIsError ? "border-[var(--status-critical)] bg-[var(--status-critical-bg)] text-[var(--status-critical)]" : "border-[var(--color-border)] bg-[var(--status-new-bg)] text-[var(--color-text)]"}`}
        >
          {feedback[status]}
        </p>
      ) : null}

      <section className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-lg font-bold">Invitar empleado</h2>
        <form
          action={inviteUser}
          className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
        >
          <label className="text-sm font-semibold">
            Nombre
            <input
              name="displayName"
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              className="mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] px-3 font-normal focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
            />
          </label>
          <label className="text-sm font-semibold">
            Correo electrónico
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] px-3 font-normal focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
            />
          </label>
          <button
            type="submit"
            className="min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
          >
            Enviar invitación
          </button>
        </form>
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          Carnales nunca solicita ni define la contraseña del empleado.
        </p>
      </section>

      <section className="mt-6 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
        <div className="border-b border-[var(--color-border)] p-5">
          <h2 className="text-lg font-bold">Empleados</h2>
        </div>
        {!result.ok ? (
          <p role="alert" className="p-5 text-sm text-[var(--status-critical)]">
            No se pudo cargar la lista de empleados.
          </p>
        ) : result.value.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-text-muted)]">
            No hay empleados registrados.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {result.value.map((user) => (
              <li
                key={user.id}
                className="grid gap-4 p-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate font-bold">{user.displayName}</p>
                  <p className="truncate text-sm text-[var(--color-text-muted)]">
                    {user.email}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {user.roleNames.length > 0
                      ? user.roleNames.map(roleLabel).join(" · ")
                      : "Sin función asignada"}
                  </p>
                </div>
                <div>
                  <span className={badgeClass(user.state)}>
                    {stateLabel(user.state)}
                  </span>
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                    Último ingreso: {formatDate(user.lastSignInAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <form action={requestPasswordReset}>
                    <input type="hidden" name="userId" value={user.id} />
                    <button
                      type="submit"
                      className="min-h-12 rounded-md border border-[var(--color-border-strong)] px-3 text-sm font-semibold hover:bg-[var(--color-surface-muted)]"
                    >
                      Restablecer acceso
                    </button>
                  </form>
                  {user.state !== "PENDING_PROFILE" ? (
                    <form action={setUserActive}>
                      <input type="hidden" name="userId" value={user.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={user.state === "INACTIVE" ? "true" : "false"}
                      />
                      <button
                        type="submit"
                        className={`min-h-12 rounded-md border px-3 text-sm font-semibold ${user.state === "ACTIVE" ? "border-[var(--brand-red)] text-[var(--brand-red)]" : "border-[var(--brand-green)] text-[var(--brand-green)]"}`}
                      >
                        {user.state === "ACTIVE" ? "Desactivar" : "Activar"}
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
function stateLabel(state: string) {
  return state === "ACTIVE"
    ? "Activo"
    : state === "INACTIVE"
      ? "Inactivo"
      : "Invitación pendiente";
}
function badgeClass(state: string) {
  return `inline-flex rounded-sm px-2 py-1 text-xs font-semibold ${state === "ACTIVE" ? "bg-[var(--status-new-bg)] text-[var(--status-new)]" : state === "INACTIVE" ? "bg-[var(--status-critical-bg)] text-[var(--status-critical)]" : "bg-[var(--color-surface-muted)] text-[var(--status-info)]"}`;
}
function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("es-EC", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Sin ingreso";
}

function roleLabel(value: string) {
  const labels: Readonly<Record<string, string>> = {
    Administrator: "Administrador",
    Waiter: "Mesero",
    "Kitchen Personnel": "Personal de cocina",
  };
  return labels[value] ?? "Función adicional";
}
