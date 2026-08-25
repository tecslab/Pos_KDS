import Link from "next/link";

import type {
  AuditLogFilterInput,
  AuditLogRecord,
  JsonValue,
} from "@/application";
import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createAuditLogService } from "@/lib/audit-log/server";

type PageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;

export default async function AuditPage({ searchParams }: PageProps) {
  await requireServerPermission("audit.log.view", "/audit");
  const params = await searchParams;
  const input: AuditLogFilterInput = Object.freeze({
    actorId: first(params.actorId),
    entityType: first(params.entityType),
    entityId: first(params.entityId),
    action: first(params.action),
    occurredFrom: first(params.occurredFrom),
    occurredTo: first(params.occurredTo),
  });
  const result = await createAuditLogService().list(input);

  return (
    <div>
      <header>
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Administración
        </p>
        <h1 className="mt-2 text-3xl font-bold">Registro de auditoría</h1>
        <p className="mt-2 max-w-4xl text-[var(--color-text-muted)]">
          Consulta eventos permanentes del sistema. Este registro es de solo
          lectura y conserva quién realizó cada acción, cuándo ocurrió y qué
          valores cambiaron.
        </p>
      </header>

      <section className={panelClass} aria-labelledby="audit-filters-title">
        <h2 id="audit-filters-title" className="text-lg font-bold">
          Filtros
        </h2>
        <form
          method="get"
          className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          <FilterField
            label="ID del usuario"
            name="actorId"
            value={input.actorId}
            maxLength={36}
            placeholder="UUID del usuario"
          />
          <FilterField
            label="Tipo de entidad"
            name="entityType"
            value={input.entityType}
            maxLength={120}
            placeholder="order, inventory_item…"
          />
          <FilterField
            label="ID de la entidad"
            name="entityId"
            value={input.entityId}
            maxLength={200}
          />
          <FilterField
            label="Acción exacta"
            name="action"
            value={input.action}
            maxLength={120}
            placeholder="order.cancelled"
          />
          <FilterField
            label="Desde"
            name="occurredFrom"
            value={input.occurredFrom}
            type="date"
          />
          <FilterField
            label="Hasta"
            name="occurredTo"
            value={input.occurredTo}
            type="date"
          />
          <div className="flex flex-wrap items-end gap-3 md:col-span-2 xl:col-span-3">
            <button type="submit" className={primaryButtonClass}>
              Filtrar registro
            </button>
            <Link href="/audit" className={secondaryButtonClass}>
              Limpiar filtros
            </Link>
          </div>
        </form>
      </section>

      {!result.ok ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-4 text-sm font-semibold text-[var(--status-critical)]"
        >
          {result.error.code === "INVALID_FILTERS"
            ? "Los filtros no son válidos. Revisa los identificadores y el rango de fechas."
            : "No se pudo cargar el registro de auditoría. Actualiza la página e inténtalo nuevamente."}
        </p>
      ) : result.value.records.length === 0 ? (
        <p
          role="status"
          className={`${panelClass} text-[var(--color-text-muted)]`}
        >
          No hay eventos de auditoría que coincidan con los filtros.
        </p>
      ) : (
        <AuditTable records={result.value.records} />
      )}
    </div>
  );
}

function AuditTable({
  records,
}: Readonly<{ records: readonly AuditLogRecord[] }>) {
  return (
    <section className="mt-6" aria-labelledby="audit-results-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="audit-results-title" className="text-xl font-bold">
          Eventos recientes
        </h2>
        <p className="text-sm tabular-nums text-[var(--color-text-muted)]">
          {records.length} evento{records.length === 1 ? "" : "s"} mostrado
          {records.length === 1 ? "" : "s"}; máximo 100
        </p>
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
        <table className="min-w-[1100px] w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Eventos de auditoría inmutables ordenados del más reciente al más
            antiguo
          </caption>
          <thead className="bg-[var(--color-surface-muted)]">
            <tr>
              <Header>Fecha y hora</Header>
              <Header>Usuario</Header>
              <Header>Entidad</Header>
              <Header>Acción</Header>
              <Header>Valores anteriores</Header>
              <Header>Valores nuevos</Header>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr
                key={record.id}
                className="border-t border-[var(--color-border)] align-top"
              >
                <td className="whitespace-nowrap p-3 tabular-nums">
                  <time dateTime={record.occurredAt}>
                    {formatTimestamp(record.occurredAt)}
                  </time>
                </td>
                <td className="p-3">
                  <p className="font-semibold">{record.actorName}</p>
                  <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
                    {record.actorId}
                  </p>
                </td>
                <td className="p-3">
                  <p className="font-semibold">{record.entityType}</p>
                  <p className="mt-1 max-w-52 break-all font-mono text-xs text-[var(--color-text-muted)]">
                    {record.entityId}
                  </p>
                </td>
                <td className="p-3 font-mono text-xs font-semibold">
                  {record.action}
                </td>
                <td className="max-w-80 p-3">
                  <AuditValue value={record.previousValues} />
                </td>
                <td className="max-w-80 p-3">
                  <AuditValue value={record.newValues} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Header({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <th scope="col" className="whitespace-nowrap p-3 font-bold">
      {children}
    </th>
  );
}

function AuditValue({ value }: Readonly<{ value: JsonValue | null }>) {
  if (value === null)
    return <span className="text-[var(--color-text-muted)]">No aplica</span>;
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function FilterField({
  label,
  name,
  value,
  type = "text",
  maxLength,
  placeholder,
}: Readonly<{
  label: string;
  name: string;
  value?: string;
  type?: "text" | "date";
  maxLength?: number;
  placeholder?: string;
}>) {
  return (
    <label className="text-sm font-semibold">
      {label}
      <input
        type={type}
        name={name}
        defaultValue={value}
        maxLength={maxLength}
        placeholder={placeholder}
        className={inputClass}
      />
    </label>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "America/Guayaquil",
  }).format(new Date(value));
}

const panelClass =
  "mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]";
const inputClass =
  "mt-2 min-h-12 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";
const primaryButtonClass =
  "inline-flex min-h-12 items-center justify-center rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white shadow-[var(--shadow-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";
const secondaryButtonClass =
  "inline-flex min-h-12 items-center justify-center rounded-md border border-[var(--color-border-strong)] bg-white px-5 font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";
