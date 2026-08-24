import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createOperatingSettingsService } from "@/lib/operating-settings/server";

import { updateOperatingSettings } from "./actions";

type PageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;
const feedback: Readonly<Record<string, string>> = {
  updated: "La configuración operativa fue actualizada.",
  invalid_input: "Revisa los valores de configuración.",
  operation_failed:
    "No se pudo guardar la configuración. Inténtalo nuevamente.",
};

export default async function OperatingSettingsPage({
  searchParams,
}: PageProps) {
  await requireServerPermission(
    "administration.restaurant.configure",
    "/administration/settings",
  );
  const result = await createOperatingSettingsService().list();
  const rawStatus = (await searchParams).status;
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
  const isError = status === "invalid_input" || status === "operation_failed";
  return (
    <div>
      <header>
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Administración
        </p>
        <h1 className="mt-2 text-3xl font-bold">Configuración operativa</h1>
        <p className="mt-2 text-[var(--color-text-muted)]">
          Identidad, impuestos y políticas aprobadas del restaurante.
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
          No se pudo cargar la configuración.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {result.value.map((settings) => (
            <form
              key={settings.restaurantId}
              action={updateOperatingSettings}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]"
            >
              <input
                type="hidden"
                name="restaurantId"
                value={settings.restaurantId}
              />
              <input
                type="hidden"
                name="taxRateId"
                value={settings.taxRateId}
              />
              <div className="grid gap-6 lg:grid-cols-2">
                <fieldset>
                  <legend className="text-lg font-bold">
                    Restaurante e impuesto
                  </legend>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="Nombre del restaurante">
                      <input
                        name="restaurantName"
                        defaultValue={settings.restaurantName}
                        required
                        minLength={2}
                        maxLength={160}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Nombre del impuesto">
                      <input
                        name="taxName"
                        defaultValue={settings.taxName}
                        required
                        minLength={2}
                        maxLength={80}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Tasa tributaria (%)">
                      <input
                        name="taxRatePercent"
                        defaultValue={settings.taxRatePercent}
                        required
                        type="number"
                        min="0"
                        max="100"
                        step="0.0001"
                        className={inputClass}
                      />
                    </Field>
                  </div>
                  <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                    Los precios del catálogo conservan su configuración
                    histórica de inclusión de impuestos.
                  </p>
                </fieldset>
                <fieldset>
                  <legend className="text-lg font-bold">Horario diario</legend>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <Field label="Apertura">
                      <input
                        name="opensAt"
                        defaultValue={settings.opensAt}
                        required
                        type="time"
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Cierre">
                      <input
                        name="closesAt"
                        defaultValue={settings.closesAt}
                        required
                        type="time"
                        className={inputClass}
                      />
                    </Field>
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="text-lg font-bold">
                    Alertas de preparación
                  </legend>
                  <Thresholds
                    prefix="preparation"
                    warning={settings.preparationWarningMinutes}
                    critical={settings.preparationCriticalMinutes}
                  />
                </fieldset>
                <fieldset>
                  <legend className="text-lg font-bold">
                    Alertas de entrega
                  </legend>
                  <Thresholds
                    prefix="delivery"
                    warning={settings.deliveryWarningMinutes}
                    critical={settings.deliveryCriticalMinutes}
                  />
                </fieldset>
                <fieldset>
                  <legend className="text-lg font-bold">Inventario</legend>
                  <label className="mt-4 flex min-h-12 items-center gap-3 rounded-md border border-[var(--color-border)] px-3">
                    <input
                      type="checkbox"
                      name="allowNegativeStock"
                      value="true"
                      defaultChecked={settings.allowNegativeStock}
                      className="h-5 w-5 accent-[var(--brand-green)]"
                    />
                    <span>Permitir existencias negativas</span>
                  </label>
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                    Desactivado en la configuración inicial aprobada.
                  </p>
                </fieldset>
                <fieldset>
                  <legend className="text-lg font-bold">Impresión</legend>
                  <div className="mt-4 rounded-md bg-[var(--color-surface-muted)] p-4">
                    <p className="font-semibold">Configuración preservada</p>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                      El comportamiento existente se conserva sin cambios. No se
                      exponen equipos, destinos ni reglas no aprobadas.
                    </p>
                  </div>
                </fieldset>
              </div>
              <button
                type="submit"
                className="mt-6 min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white"
              >
                Guardar configuración
              </button>
            </form>
          ))}
        </div>
      )}
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
function Thresholds({
  prefix,
  warning,
  critical,
}: Readonly<{
  prefix: "preparation" | "delivery";
  warning: number;
  critical: number;
}>) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-4">
      <Field label="Advertencia (min)">
        <input
          name={`${prefix}WarningMinutes`}
          defaultValue={warning}
          required
          type="number"
          min="0"
          max="1440"
          className={inputClass}
        />
      </Field>
      <Field label="Crítico (min)">
        <input
          name={`${prefix}CriticalMinutes`}
          defaultValue={critical}
          required
          type="number"
          min="0"
          max="1440"
          className={inputClass}
        />
      </Field>
    </div>
  );
}
const inputClass =
  "mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] px-3 font-normal focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";
