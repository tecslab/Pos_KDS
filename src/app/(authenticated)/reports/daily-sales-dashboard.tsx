import type {
  DailySalesReport,
  DailySalesReportRestaurant,
} from "@/application";

type DailySalesDashboardProps = Readonly<{
  report: DailySalesReport;
  restaurants: readonly DailySalesReportRestaurant[];
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
    </div>
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
