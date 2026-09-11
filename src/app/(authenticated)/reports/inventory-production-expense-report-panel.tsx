import type {
  ExpenseCategoryTotal,
  InventoryProductionExpenseReport,
  InventoryReportCorrection,
} from "@/application";

const currency = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function InventoryProductionExpenseReportPanel({
  report,
}: Readonly<{ report: InventoryProductionExpenseReport }>) {
  return (
    <section
      aria-labelledby="inventory-production-expense-title"
      className="mt-5 space-y-5"
    >
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]">
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Inventario y operación
        </p>
        <h2
          id="inventory-production-expense-title"
          className="mt-1 text-xl font-bold"
        >
          Existencias, producción y gastos
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Las existencias y alertas muestran el estado persistido actual. Los
          movimientos, compras, producción y gastos corresponden al día local
          seleccionado; el resumen mensual usa el mes de esa fecha.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Artículos"
            value={String(report.inventoryBalances.length)}
          />
          <Metric
            label="Alertas activas"
            value={String(report.activeAlerts.length)}
          />
          <Metric
            label="Gastos del día"
            value={formatMoney(report.dailyExpenseTotal)}
          />
          <Metric
            label="Gastos del mes"
            value={formatMoney(report.monthlyExpenseTotal)}
          />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <InventoryBalances report={report} />
        <ActiveAlerts report={report} />
      </div>
      <Movements report={report} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Purchases report={report} />
        <Production report={report} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Corrections
          id="inventory-adjustments-title"
          title="Ajustes del día"
          empty="No se registraron ajustes en el día."
          rows={report.adjustments}
        />
        <Corrections
          id="inventory-waste-title"
          title="Desperdicios del día"
          empty="No se registraron desperdicios en el día."
          rows={report.wasteRecords}
        />
      </div>
      <ExpenseSummary report={report} />
    </section>
  );
}

function InventoryBalances({
  report,
}: Readonly<{ report: InventoryProductionExpenseReport }>) {
  return (
    <ReportTable id="inventory-balances-title" title="Existencias actuales">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
          <tr>
            <Column>Artículo</Column>
            <Column align="right">Existencia</Column>
            <Column align="right">Mínimo</Column>
            <Column>Estado</Column>
          </tr>
        </thead>
        <tbody>
          {report.inventoryBalances.length === 0 ? (
            <Empty columns={4}>
              No hay artículos de inventario registrados.
            </Empty>
          ) : (
            report.inventoryBalances.map((row) => (
              <tr
                key={row.inventoryItemId}
                className="border-t border-[var(--color-border)]"
              >
                <th scope="row" className="px-4 py-3 font-semibold">
                  {row.inventoryItemName}
                  <span className="mt-1 block text-xs font-normal text-[var(--color-text-muted)]">
                    {row.inventoryItemType}
                  </span>
                </th>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.currentBalance} {row.unitOfMeasure}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.minimumStockLevel} {row.unitOfMeasure}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      row.isBelowMinimum
                        ? "rounded-sm bg-[var(--status-warning-bg)] px-2 py-1 font-semibold text-[var(--status-warning)]"
                        : "rounded-sm bg-[var(--status-new-bg)] px-2 py-1 font-semibold text-[var(--status-new)]"
                    }
                  >
                    {row.isBelowMinimum ? "Bajo mínimo" : "Disponible"}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </ReportTable>
  );
}

function ActiveAlerts({
  report,
}: Readonly<{ report: InventoryProductionExpenseReport }>) {
  return (
    <ReportTable id="inventory-alerts-title" title="Alertas activas de stock">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
          <tr>
            <Column>Artículo</Column>
            <Column align="right">Observado / umbral</Column>
            <Column>Abierta</Column>
          </tr>
        </thead>
        <tbody>
          {report.activeAlerts.length === 0 ? (
            <Empty columns={3}>No hay alertas activas de stock.</Empty>
          ) : (
            report.activeAlerts.map((row) => (
              <tr
                key={row.id}
                className="border-t border-[var(--color-border)]"
              >
                <th scope="row" className="px-4 py-3 font-semibold">
                  {row.inventoryItemName}
                </th>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.observedBalance} / {row.threshold} {row.unitOfMeasure}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {formatLocalDateTime(row.openedAt)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </ReportTable>
  );
}

function Movements({
  report,
}: Readonly<{ report: InventoryProductionExpenseReport }>) {
  return (
    <ReportTable
      id="inventory-movements-title"
      title="Movimientos inmutables del día"
    >
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
          <tr>
            <Column>Hora</Column>
            <Column>Artículo</Column>
            <Column>Tipo</Column>
            <Column align="right">Cantidad</Column>
            <Column>Origen</Column>
          </tr>
        </thead>
        <tbody>
          {report.movements.length === 0 ? (
            <Empty columns={5}>No se registraron movimientos en el día.</Empty>
          ) : (
            report.movements.map((row) => (
              <tr
                key={row.id}
                className="border-t border-[var(--color-border)]"
              >
                <td className="px-4 py-3 tabular-nums">
                  {formatLocalTime(row.recordedAt)}
                </td>
                <th scope="row" className="px-4 py-3 font-semibold">
                  {row.inventoryItemName}
                </th>
                <td className="px-4 py-3">{movementLabel(row.type)}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {row.quantityDelta} {row.unitOfMeasure}
                </td>
                <td className="px-4 py-3">
                  {row.businessOriginType}
                  {row.reversedMovementId ? (
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      Reversión registrada
                    </span>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </ReportTable>
  );
}

function Purchases({
  report,
}: Readonly<{ report: InventoryProductionExpenseReport }>) {
  return (
    <ReportTable id="inventory-purchases-title" title="Compras del día">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
          <tr>
            <Column>Hora / proveedor</Column>
            <Column>Categoría</Column>
            <Column>Detalle</Column>
            <Column align="right">Total</Column>
          </tr>
        </thead>
        <tbody>
          {report.purchases.length === 0 ? (
            <Empty columns={4}>No se registraron compras en el día.</Empty>
          ) : (
            report.purchases.map((row) => (
              <tr
                key={row.id}
                className="border-t border-[var(--color-border)] align-top"
              >
                <th scope="row" className="px-4 py-3 font-semibold">
                  {formatLocalTime(row.recordedAt)}
                  <span className="block text-xs font-normal text-[var(--color-text-muted)]">
                    {row.supplierName ?? "Sin proveedor"}
                  </span>
                </th>
                <td className="px-4 py-3">
                  {row.expenseCategoryName}
                  <span className="block text-xs text-[var(--color-text-muted)]">
                    {row.expenseCategoryCode}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <ul className="space-y-1">
                    {row.lines.map((line) => (
                      <li key={line.inventoryMovementId}>
                        {line.inventoryItemName}:{" "}
                        <span className="tabular-nums">
                          {line.quantity} {line.unitOfMeasure} ·{" "}
                          {formatMoney(line.lineTotal)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {formatMoney(row.totalAmount)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </ReportTable>
  );
}

function Production({
  report,
}: Readonly<{ report: InventoryProductionExpenseReport }>) {
  return (
    <ReportTable
      id="production-batches-report-title"
      title="Producción completada del día"
    >
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
          <tr>
            <Column>Hora</Column>
            <Column>Receta</Column>
            <Column>Producto</Column>
            <Column align="right">Cantidad</Column>
          </tr>
        </thead>
        <tbody>
          {report.productionBatches.length === 0 ? (
            <Empty columns={4}>No se completó producción en el día.</Empty>
          ) : (
            report.productionBatches.map((row) => (
              <tr
                key={row.id}
                className="border-t border-[var(--color-border)]"
              >
                <td className="px-4 py-3 tabular-nums">
                  {formatLocalTime(row.completedAt)}
                </td>
                <th scope="row" className="px-4 py-3 font-semibold">
                  {row.recipeName}
                  <span className="block text-xs font-normal text-[var(--color-text-muted)]">
                    Versión {row.recipeVersionNumber}
                  </span>
                </th>
                <td className="px-4 py-3">{row.outputInventoryItemName}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {row.producedQuantity} {row.unitOfMeasure}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </ReportTable>
  );
}

function Corrections({
  id,
  title,
  empty,
  rows,
}: Readonly<{
  id: string;
  title: string;
  empty: string;
  rows: readonly InventoryReportCorrection[];
}>) {
  return (
    <ReportTable id={id} title={title}>
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
          <tr>
            <Column>Hora</Column>
            <Column>Artículo</Column>
            <Column align="right">Cantidad</Column>
            <Column>Motivo</Column>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <Empty columns={4}>{empty}</Empty>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                className="border-t border-[var(--color-border)]"
              >
                <td className="px-4 py-3 tabular-nums">
                  {formatLocalTime(row.recordedAt)}
                </td>
                <th scope="row" className="px-4 py-3 font-semibold">
                  {row.inventoryItemName}
                </th>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {row.quantity} {row.unitOfMeasure}
                </td>
                <td className="px-4 py-3">{row.reason}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </ReportTable>
  );
}

function ExpenseSummary({
  report,
}: Readonly<{ report: InventoryProductionExpenseReport }>) {
  return (
    <section aria-labelledby="expense-report-title" className="space-y-5">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]">
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Gastos operativos
        </p>
        <h3 id="expense-report-title" className="mt-1 text-lg font-bold">
          Detalle y resúmenes reproducibles
        </h3>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Las categorías son las instantáneas guardadas con cada gasto, incluso
          si la configuración cambia después.
        </p>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <ExpenseCategories
          id="daily-expenses-category-title"
          title="Gastos del día por categoría"
          rows={report.dailyExpensesByCategory}
        />
        <ExpenseCategories
          id="monthly-expenses-category-title"
          title="Gastos del mes por categoría"
          rows={report.monthlyExpensesByCategory}
        />
      </div>
      <ReportTable id="expense-history-title" title="Gastos del día">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
            <tr>
              <Column>Hora</Column>
              <Column>Descripción</Column>
              <Column>Categoría guardada</Column>
              <Column>Origen</Column>
              <Column align="right">Monto</Column>
            </tr>
          </thead>
          <tbody>
            {report.expenses.length === 0 ? (
              <Empty columns={5}>No se registraron gastos en el día.</Empty>
            ) : (
              report.expenses.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="px-4 py-3 tabular-nums">
                    {formatLocalTime(row.incurredAt)}
                  </td>
                  <th scope="row" className="px-4 py-3 font-semibold">
                    {row.description}
                  </th>
                  <td className="px-4 py-3">
                    {row.expenseCategoryName}
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      {row.expenseCategoryCode}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {row.originType === "PURCHASE" ? "Compra" : "Manual"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatMoney(row.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ReportTable>
      <ReportTable
        id="monthly-expenses-days-title"
        title="Totales diarios del mes"
      >
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
            <tr>
              <Column>Fecha local</Column>
              <Column align="right">Gastos</Column>
            </tr>
          </thead>
          <tbody>
            {report.monthlyExpensesByDay.map((row) => (
              <tr
                key={row.date}
                className="border-t border-[var(--color-border)]"
              >
                <th
                  scope="row"
                  className="px-4 py-2 font-semibold tabular-nums"
                >
                  {row.date}
                </th>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatMoney(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ReportTable>
    </section>
  );
}

function ExpenseCategories({
  id,
  title,
  rows,
}: Readonly<{
  id: string;
  title: string;
  rows: readonly ExpenseCategoryTotal[];
}>) {
  return (
    <ReportTable id={id} title={title}>
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
          <tr>
            <Column>Categoría guardada</Column>
            <Column align="right">Monto</Column>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <Empty columns={2}>No hay gastos para resumir.</Empty>
          ) : (
            rows.map((row) => (
              <tr
                key={`${row.expenseCategoryCode}:${row.expenseCategoryName}`}
                className="border-t border-[var(--color-border)]"
              >
                <th scope="row" className="px-4 py-3 font-semibold">
                  {row.expenseCategoryName}
                  <span className="block text-xs font-normal text-[var(--color-text-muted)]">
                    {row.expenseCategoryCode}
                  </span>
                </th>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {formatMoney(row.amount)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </ReportTable>
  );
}

function ReportTable({
  id,
  title,
  children,
}: Readonly<{ id: string; title: string; children: React.ReactNode }>) {
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]"
    >
      <h3
        id={id}
        className="border-b border-[var(--color-border)] px-5 py-4 text-lg font-bold"
      >
        {title}
      </h3>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}
function Column({
  children,
  align,
}: Readonly<{ children: React.ReactNode; align?: "right" }>) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 font-semibold${align ? " text-right" : ""}`}
    >
      {children}
    </th>
  );
}
function Empty({
  columns,
  children,
}: Readonly<{ columns: number; children: React.ReactNode }>) {
  return (
    <tr>
      <td
        colSpan={columns}
        className="px-4 py-4 text-[var(--color-text-muted)]"
      >
        {children}
      </td>
    </tr>
  );
}
function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="text-sm font-semibold text-[var(--color-text-muted)]">
        {label}
      </h3>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </article>
  );
}
function formatMoney(value: string) {
  return currency.format(Number(value));
}
function formatLocalTime(value: string) {
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
function formatLocalDateTime(value: string) {
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    dateStyle: "short",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(new Date(value));
}
function movementLabel(
  value: InventoryProductionExpenseReport["movements"][number]["type"],
) {
  return (
    {
      PURCHASE: "Compra",
      PRODUCTION_CONSUMPTION: "Consumo de producción",
      PRODUCTION_OUTPUT: "Salida de producción",
      SALE: "Venta",
      ADJUSTMENT: "Ajuste",
      WASTE: "Desperdicio",
      ROLLBACK: "Reversión",
    } as const
  )[value];
}
