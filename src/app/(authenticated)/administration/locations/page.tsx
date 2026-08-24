import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createServiceLocationAdministrationService } from "@/lib/service-location-administration/server";

import { saveServiceLocation } from "./actions";

type PageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;
const feedback: Readonly<Record<string, string>> = {
  created: "La ubicación fue creada.",
  updated: "La ubicación fue actualizada.",
  invalid_input: "Revisa los datos de la ubicación.",
  operation_failed: "No se pudo guardar la ubicación. Inténtalo nuevamente.",
};

export default async function ServiceLocationsPage({
  searchParams,
}: PageProps) {
  await requireServerPermission(
    "administration.locations.manage",
    "/administration/locations",
  );
  const result = await createServiceLocationAdministrationService().list();
  const rawStatus = (await searchParams).status;
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
  const isError = status === "invalid_input" || status === "operation_failed";
  const restaurants = result.ok
    ? [
        ...new Map(
          result.value.map((item) => [item.restaurantId, item.restaurantName]),
        ).entries(),
      ]
    : [];
  return (
    <div>
      <header>
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Administración
        </p>
        <h1 className="mt-2 text-3xl font-bold">Ubicaciones de servicio</h1>
        <p className="mt-2 text-[var(--color-text-muted)]">
          Mesas, ventanillas, mostradores y futuras áreas de atención.
        </p>
      </header>
      {status && feedback[status] ? (
        <p
          role={isError ? "alert" : "status"}
          className={`mt-5 rounded-md border p-4 text-sm font-semibold ${isError ? "border-[var(--status-critical)] bg-[var(--status-critical-bg)] text-[var(--status-critical)]" : "border-[var(--color-border)] bg-[var(--status-new-bg)]"}`}
        >
          {feedback[status]}
        </p>
      ) : null}
      {!result.ok ? (
        <p role="alert" className="mt-6 text-[var(--status-critical)]">
          No se pudieron cargar las ubicaciones.
        </p>
      ) : (
        <>
          <section className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]">
            <h2 className="text-lg font-bold">Nueva ubicación</h2>
            <LocationForm restaurants={restaurants} />
          </section>
          <section className="mt-6">
            <h2 className="text-xl font-bold">Ubicaciones configuradas</h2>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {result.value.map((location) => (
                <form
                  key={location.id}
                  action={saveServiceLocation}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]"
                >
                  <input type="hidden" name="id" value={location.id} />
                  <input
                    type="hidden"
                    name="restaurantId"
                    value={location.restaurantId}
                  />
                  <p className="font-bold">{location.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {location.restaurantName}
                  </p>
                  <LocationFields location={location} />
                  <button
                    type="submit"
                    className="mt-4 min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white"
                  >
                    Guardar cambios
                  </button>
                </form>
              ))}
            </div>
          </section>
        </>
      )}
      <datalist id="location-types">
        <option value="TABLE" />
        <option value="DISPATCH_WINDOW" />
        <option value="COUNTER" />
      </datalist>
    </div>
  );
}

type LocationDraft = Readonly<{
  name: string;
  type: string;
  displayOrder: number;
  isActive: boolean;
  allowsMultipleActiveOrders: boolean;
}>;
function LocationForm({
  restaurants,
}: Readonly<{ restaurants: [string, string][] }>) {
  return (
    <form action={saveServiceLocation}>
      <label className="mt-4 block text-sm font-semibold">
        Restaurante
        <select name="restaurantId" required className={inputClass}>
          {restaurants.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <LocationFields />
      <button
        type="submit"
        disabled={restaurants.length === 0}
        className="mt-4 min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white disabled:bg-[var(--status-disabled)]"
      >
        Crear ubicación
      </button>
    </form>
  );
}
function LocationFields({ location }: Readonly<{ location?: LocationDraft }>) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Field label="Nombre">
        <input
          name="name"
          defaultValue={location?.name}
          required
          maxLength={120}
          className={inputClass}
        />
      </Field>
      <Field label="Tipo">
        <input
          name="type"
          list="location-types"
          defaultValue={location?.type}
          required
          maxLength={80}
          className={inputClass}
        />
      </Field>
      <Field label="Orden de visualización">
        <input
          name="displayOrder"
          type="number"
          min="0"
          max="100000"
          defaultValue={location?.displayOrder ?? 0}
          required
          className={inputClass}
        />
      </Field>
      <label className="flex min-h-12 items-center gap-3 rounded-md border border-[var(--color-border)] px-3">
        <input
          type="checkbox"
          name="isActive"
          value="true"
          defaultChecked={location?.isActive ?? true}
          className="h-5 w-5 accent-[var(--brand-green)]"
        />
        Ubicación activa
      </label>
      <label className="flex min-h-12 items-center gap-3 rounded-md border border-[var(--color-border)] px-3 sm:col-span-2">
        <input
          type="checkbox"
          name="allowsMultipleActiveOrders"
          value="true"
          defaultChecked={location?.allowsMultipleActiveOrders ?? false}
          className="h-5 w-5 accent-[var(--brand-green)]"
        />
        Permitir múltiples órdenes activas simultáneas
      </label>
    </div>
  );
}
function Field({
  label,
  children,
}: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <label className="text-sm font-semibold">
      {label}
      {children}
    </label>
  );
}
const inputClass =
  "mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] px-3 font-normal focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";
