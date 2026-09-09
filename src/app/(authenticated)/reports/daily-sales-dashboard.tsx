import type {
  DailySalesReport,
  DailySalesReportRestaurant,
  OperationalPerformanceReport,
} from "@/application";

type DailySalesDashboardProps = Readonly<{
  report: DailySalesReport;
  restaurants: readonly DailySalesReportRestaurant[];
  operationalReport: OperationalPerformanceReport;
}>;

const currency = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function DailySalesDashboard({
  report,
  restaurants,
  operationalReport,
}: DailySalesDashboardProps) {
  const peakRevenue = Math.max(
    0,
    ...report.hourlyRevenue.map((bucket) => Number(bucket.amount)),
  );

  return (
    <div className="mx-auto max-w-[var(--content-max)]">
      <header className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)] sm:p-6">
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Reporte diario
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-3xl font-bold">Ventas del día</h1>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              Datos operativos persistidos · día local de Guayaquil, de 00:00 a
              24:00.
            </p>
          </div>
          <form
            action="/reports"
            method="get"
            className="flex flex-wrap items-end gap-3"
          >
            <div>
              <label
                htmlFor="report-restaurant"
                className="block text-sm font-semibold"
              >
                Restaurante
              </label>
              <select
                id="report-restaurant"
                name="restaurantId"
                defaultValue={report.restaurant.id}
                className="mt-1 min-h-12 min-w-52 rounded-md border border-[var(--color-border-strong)] bg-white px-3"
              >
                {restaurants.map((restaurant) => (
                  <option key={restaurant.id} value={restaurant.id}>
                    {restaurant.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="report-date"
                className="block text-sm font-semibold"
              >
                Fecha
              </label>
              <input
                id="report-date"
                name="date"
                type="date"
                required
                defaultValue={report.date}
                className="mt-1 min-h-12 rounded-md border border-[var(--color-border-strong)] bg-white px-3 tabular-nums"
              />
            </div>
            <button
              type="submit"
              className="min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white shadow-[var(--shadow-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
            >
              Consultar
            </button>
          </form>
        </div>
      </header>

      <section
        aria-label="Indicadores diarios de ventas"
        className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Metric label="Ingresos" value={formatMoney(report.totalRevenue)} />
        <Metric label="Órdenes creadas" value={String(report.ordersCreated)} />
        <Metric
          label="Órdenes completadas"
          value={String(report.ordersCompleted)}
        />
        <Metric
          label="Ticket promedio"
          value={formatMoney(report.averageTicket)}
        />
      </section>

      <section
        className="mt-5 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]"
        aria-labelledby="hourly-revenue-title"
      >
        <div className="border-b border-[var(--color-border)] p-5">
          <h2 id="hourly-revenue-title" className="text-xl font-bold">
            Ingresos por hora
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Las 24 horas se muestran aunque no hayan registrado pagos.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">
              Ingresos cobrados en cada hora local del día seleccionado
            </caption>
            <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
              <tr>
                <th scope="col" className="w-28 px-4 py-3 font-semibold">
                  Hora
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Distribución
                </th>
                <th
                  scope="col"
                  className="w-36 px-4 py-3 text-right font-semibold"
                >
                  Ingresos
                </th>
              </tr>
            </thead>
            <tbody>
              {report.hourlyRevenue.map((bucket) => {
                const percentage =
                  peakRevenue === 0
                    ? 0
                    : (Number(bucket.amount) / peakRevenue) * 100;
                return (
                  <tr
                    key={bucket.hour}
                    className="border-t border-[var(--color-border)]"
                  >
                    <th
                      scope="row"
                      className="px-4 py-2 font-semibold tabular-nums"
                    >
                      {String(bucket.hour).padStart(2, "0")}:00
                    </th>
                    <td className="min-w-48 px-4 py-2">
                      <div className="h-3 overflow-hidden rounded-sm bg-[var(--color-surface-muted)]">
                        <div
                          aria-hidden="true"
                          className="h-full bg-[var(--brand-green)]"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">
                      {formatMoney(bucket.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <OperationalPerformancePanel report={operationalReport} />
    </div>
  );
}

function OperationalPerformancePanel({
  report,
}: Readonly<{ report: OperationalPerformanceReport }>) {
  const peak = Math.max(
    0,
    ...report.peakPreparationPeriods.map((period) => period.orders),
  );

  return (
    <>
      <section aria-labelledby="product-performance-title" className="mt-5">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]">
          <p className="text-sm font-semibold text-[var(--brand-green)]">
            Métricas operativas
          </p>
          <h2 id="product-performance-title" className="mt-1 text-xl font-bold">
            Productos y categorías vendidos
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Cantidades e ingresos se conservan con la venta. Las ventas
            históricas sin categoría se muestran sin inferir el catálogo actual.
          </p>
          <div className="mt-4 grid gap-5 xl:grid-cols-2">
            <SalesTable
              title="Productos más vendidos"
              products={report.productSales}
            />
            <SalesTable
              title="Ventas por categoría"
              categories={report.categorySales}
            />
          </div>
        </div>
      </section>

      <section
        aria-labelledby="kitchen-performance-title"
        className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.4fr]"
      >
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]">
          <p className="text-sm font-semibold text-[var(--brand-green)]">
            Cocina
          </p>
          <h2 id="kitchen-performance-title" className="mt-1 text-xl font-bold">
            Preparación
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <Metric
              label="Promedio"
              value={`${report.averagePreparationMinutes} min`}
            />
            <Metric
              label="Mayor tiempo"
              value={`${report.longestPreparationMinutes} min`}
            />
            <Metric
              label="En preparación ahora"
              value={String(report.ordersCurrentlyInPreparation)}
            />
          </div>
        </div>
        <HourlyOrders periods={report.peakPreparationPeriods} peak={peak} />
      </section>

      <section
        aria-labelledby="delivery-performance-title"
        className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]"
      >
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Entrega
        </p>
        <h2 id="delivery-performance-title" className="mt-1 text-xl font-bold">
          Tiempos y cuellos de botella
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          El cuello de botella visible es la cola persistida de órdenes listas
          que aún esperan salida.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Listo a en camino"
            value={`${report.averageReadyToOnTheWayMinutes} min`}
          />
          <Metric
            label="En camino a entregado"
            value={`${report.averageOnTheWayToDeliveredMinutes} min`}
          />
          <Metric
            label="Órdenes entregadas"
            value={String(report.deliveredOrders)}
          />
          <Metric
            label="Esperando entrega"
            value={String(report.ordersWaitingForDelivery)}
          />
        </div>
      </section>
    </>
  );
}

function SalesTable({
  title,
  products,
  categories,
}: Readonly<{
  title: string;
  products?: OperationalPerformanceReport["productSales"];
  categories?: OperationalPerformanceReport["categorySales"];
}>) {
  const rows = products
    ? products.map((product) => ({
        key: product.productId,
        name: product.productName,
        quantitySold: product.quantitySold,
        revenue: product.revenue,
      }))
    : (categories ?? []).map((category) => ({
        key: `${category.categoryId}:${category.categoryName}`,
        name: category.categoryName,
        quantitySold: category.quantitySold,
        revenue: category.revenue,
      }));
  return (
    <section className="overflow-hidden rounded-md border border-[var(--color-border)]">
      <h3 className="border-b border-[var(--color-border)] px-4 py-3 font-bold">
        {title}
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
            <tr>
              <th scope="col" className="px-4 py-2 font-semibold">
                Nombre
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Cantidad
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Ingresos
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-3 text-[var(--color-text-muted)]"
                >
                  Sin ventas registradas.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.key}
                  className="border-t border-[var(--color-border)]"
                >
                  <th scope="row" className="px-4 py-2 font-semibold">
                    {row.name}
                  </th>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {row.quantitySold}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">
                    {formatMoney(row.revenue)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HourlyOrders({
  periods,
  peak,
}: Readonly<{
  periods: OperationalPerformanceReport["peakPreparationPeriods"];
  peak: number;
}>) {
  return (
    <section
      className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]"
      aria-labelledby="preparation-peaks-title"
    >
      <div className="border-b border-[var(--color-border)] p-5">
        <h2 id="preparation-peaks-title" className="text-xl font-bold">
          Picos de preparación
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Órdenes que ingresaron a preparación por hora local.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 sm:grid-cols-3">
        {periods.map((period) => (
          <div key={period.hour} className="flex items-center gap-2 text-sm">
            <span className="w-11 tabular-nums">
              {String(period.hour).padStart(2, "0")}:00
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded bg-[var(--color-surface-muted)]">
              <div
                className="h-full bg-[var(--brand-green)]"
                style={{
                  width: `${peak === 0 ? 0 : (period.orders / peak) * 100}%`,
                }}
              />
            </div>
            <span className="w-5 text-right tabular-nums">{period.orders}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]">
      <h2 className="text-sm font-semibold text-[var(--color-text-muted)]">
        {label}
      </h2>
      <p className="mt-2 text-3xl font-bold tabular-nums">{value}</p>
    </article>
  );
}

function formatMoney(value: string) {
  return currency.format(Number(value));
}
