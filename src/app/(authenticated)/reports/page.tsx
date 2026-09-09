import { currentGuayaquilDate, REPORTING_TIME_ZONE } from "@/application";
import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createDailySalesReportService } from "@/lib/daily-sales-report/server";
import { createOperationalPerformanceReportService } from "@/lib/operational-performance-report/server";

import { DailySalesDashboard } from "./daily-sales-dashboard";

type ReportsPageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const authorization = await requireServerPermission(
    "reports.view",
    "/reports",
  );
  const service = createDailySalesReportService();
  const operationalService = createOperationalPerformanceReportService();
  const [restaurantsResult, params] = await Promise.all([
    service.listRestaurants(),
    searchParams,
  ]);

  if (!restaurantsResult.ok) {
    return <ReportFailure message="No se pudieron cargar los restaurantes." />;
  }
  if (restaurantsResult.value.length === 0) {
    return (
      <ReportFailure message="No hay restaurantes activos para consultar." />
    );
  }

  const restaurantId =
    first(params.restaurantId) ?? restaurantsResult.value[0].id;
  const date = first(params.date) ?? currentGuayaquilDate();
  const [report, operationalReport] = await Promise.all([
    service.read({
      actorId: authorization.userId,
      restaurantId,
      date,
      timeZone: REPORTING_TIME_ZONE,
    }),
    operationalService.read({
      actorId: authorization.userId,
      restaurantId,
      date,
      timeZone: REPORTING_TIME_ZONE,
    }),
  ]);

  if (!report.ok) {
    return (
      <ReportFailure
        message={
          report.error.code === "INVALID_INPUT"
            ? "La fecha o el restaurante seleccionado no es válido."
            : report.error.code === "RESTAURANT_NOT_FOUND"
              ? "El restaurante seleccionado no está disponible."
              : "No se pudo cargar el reporte diario."
        }
      />
    );
  }
  if (!operationalReport.ok) {
    return <ReportFailure message="No se pudo cargar el reporte operativo." />;
  }

  return (
    <DailySalesDashboard
      report={report.value}
      restaurants={restaurantsResult.value}
      operationalReport={operationalReport.value}
    />
  );
}

function ReportFailure({ message }: Readonly<{ message: string }>) {
  return (
    <section
      role="alert"
      className="rounded-lg border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-6 text-[var(--status-critical)]"
    >
      <h1 className="text-2xl font-bold">No se pudo mostrar el reporte</h1>
      <p className="mt-2">
        {message} Revisa la selección e inténtalo nuevamente.
      </p>
    </section>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
