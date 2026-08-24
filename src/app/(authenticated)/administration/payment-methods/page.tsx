import type { PaymentMethod } from "@/application";
import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createPaymentMethodAdministrationService } from "@/lib/payment-method-administration/server";
import { savePaymentMethod } from "./actions";

type PageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;
const feedback: Readonly<Record<string, string>> = {
  created: "El método de pago fue creado.",
  updated: "El método de pago fue actualizado.",
  invalid_input: "Revisa los datos del método de pago.",
  operation_failed:
    "No se pudo guardar el método de pago. Inténtalo nuevamente.",
};

export default async function PaymentMethodsPage({ searchParams }: PageProps) {
  await requireServerPermission(
    "administration.payment_methods.configure",
    "/administration/payment-methods",
  );
  const result = await createPaymentMethodAdministrationService().list();
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
        <h1 className="mt-2 text-3xl font-bold">
          Métodos de pago y comprobantes
        </h1>
        <p className="mt-2 text-[var(--color-text-muted)]">
          Configura disponibilidad, datos bancarios y el texto impreso. Los
          pagos históricos conservan su nombre original.
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
          No se pudieron cargar los métodos de pago.
        </p>
      ) : (
        <>
          <section className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]">
            <h2 className="text-lg font-bold">Nuevo método</h2>
            <MethodForm restaurants={restaurants} />
          </section>
          <section className="mt-6">
            <h2 className="text-xl font-bold">Métodos configurados</h2>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {result.value.map((method) => (
                <form
                  key={method.id}
                  action={savePaymentMethod}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]"
                >
                  <input type="hidden" name="id" value={method.id} />
                  <input
                    type="hidden"
                    name="restaurantId"
                    value={method.restaurantId}
                  />
                  <p className="font-bold">{method.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {method.restaurantName}
                  </p>
                  <MethodFields method={method} />
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
    </div>
  );
}

function MethodForm({
  restaurants,
}: Readonly<{ restaurants: [string, string][] }>) {
  return (
    <form action={savePaymentMethod}>
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
      <MethodFields />
      <button
        type="submit"
        disabled={restaurants.length === 0}
        className="mt-4 min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white disabled:bg-[var(--status-disabled)]"
      >
        Crear método
      </button>
    </form>
  );
}
function MethodFields({ method }: Readonly<{ method?: PaymentMethod }>) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Field label="Código">
        <input
          name="code"
          defaultValue={method?.code}
          required
          maxLength={50}
          pattern="[a-z][a-z0-9_]*"
          className={inputClass}
        />
      </Field>
      <Field label="Nombre">
        <input
          name="name"
          defaultValue={method?.name}
          required
          maxLength={120}
          className={inputClass}
        />
      </Field>
      <Field label="Orden de visualización">
        <input
          name="displayOrder"
          type="number"
          min="0"
          max="100000"
          defaultValue={method?.displayOrder ?? 0}
          required
          className={inputClass}
        />
      </Field>
      <Check
        name="isActive"
        label="Método activo"
        checked={method?.isActive ?? true}
      />
      <Check
        name="isBankTransfer"
        label="Es transferencia bancaria"
        checked={method?.isBankTransfer ?? false}
      />
      <Field label="Banco">
        <input
          name="bankName"
          defaultValue={method?.bankName}
          maxLength={120}
          className={inputClass}
        />
      </Field>
      <Field label="Titular de la cuenta">
        <input
          name="accountHolder"
          defaultValue={method?.accountHolder}
          maxLength={120}
          className={inputClass}
        />
      </Field>
      <Field label="Número de cuenta">
        <input
          name="accountNumber"
          defaultValue={method?.accountNumber}
          maxLength={80}
          className={inputClass}
          autoComplete="off"
        />
      </Field>
      <Field label="Encabezado del comprobante">
        <textarea
          name="receiptHeader"
          defaultValue={method?.receiptHeader}
          maxLength={500}
          rows={3}
          className={inputClass}
        />
      </Field>
      <Field label="Pie del comprobante">
        <textarea
          name="receiptFooter"
          defaultValue={method?.receiptFooter}
          maxLength={500}
          rows={3}
          className={inputClass}
        />
      </Field>
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
function Check({
  name,
  label,
  checked,
}: Readonly<{ name: string; label: string; checked: boolean }>) {
  return (
    <label className="flex min-h-12 items-center gap-3 rounded-md border border-[var(--color-border)] px-3">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={checked}
        className="h-5 w-5 accent-[var(--brand-green)]"
      />
      {label}
    </label>
  );
}
const inputClass =
  "mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] px-3 py-2 font-normal focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";
