import { err, ok, type Result } from "../../domain";
import type { AuditEventService } from "../audit";
import {
  parseDailySalesReportQuery,
  type DailySalesReport,
  type DailySalesReportInput,
  type DailySalesReportService,
} from "../daily-sales-report";
import type {
  InventoryProductionExpenseReport,
  InventoryProductionExpenseReportService,
} from "../inventory-production-expense-report";
import type {
  OperationalPerformanceReport,
  OperationalPerformanceReportService,
} from "../operational-performance-report";
import type { PaymentReport, PaymentReportService } from "../payment-report";

export const REPORT_EXPORT_FORMATS = Object.freeze(["pdf", "xlsx"] as const);
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

export type ReportExportInput = DailySalesReportInput &
  Readonly<{ format: unknown }>;

export type ReportExportCell = Readonly<{
  value: string;
  kind?: "money" | "number";
}>;

export type ReportExportSection = Readonly<{
  title: string;
  columns: readonly string[];
  rows: readonly (readonly ReportExportCell[])[];
}>;

export type ReportExportDocument = Readonly<{
  title: "Reporte operativo completo";
  restaurant: Readonly<{ id: string; name: string }>;
  date: string;
  timeZone: string;
  periodStart: string;
  periodEnd: string;
  sections: readonly ReportExportSection[];
}>;

export type RenderedReportExport = Readonly<{
  bytes: Uint8Array;
  contentType: string;
  extension: "pdf" | "xlsx";
}>;

export interface ReportExportRenderer {
  render(document: ReportExportDocument): Promise<RenderedReportExport>;
}

export type ReportExportResult = RenderedReportExport &
  Readonly<{ filename: string }>;

export type ReportExportError = Readonly<{
  kind: "report-export-error";
  code:
    | "INVALID_INPUT"
    | "RESTAURANT_NOT_FOUND"
    | "UNAUTHORIZED"
    | "OPERATION_FAILED";
}>;

type ReportReaderService<T> = Readonly<{
  read(input: DailySalesReportInput): Promise<
    Result<
      T,
      Readonly<{
        code:
          | "INVALID_INPUT"
          | "RESTAURANT_NOT_FOUND"
          | "UNAUTHORIZED"
          | "OPERATION_FAILED";
      }>
    >
  >;
}>;

export class ReportExportService {
  constructor(
    private readonly dailySales: Pick<DailySalesReportService, "read">,
    private readonly operational: Pick<
      OperationalPerformanceReportService,
      "read"
    >,
    private readonly payments: Pick<PaymentReportService, "read">,
    private readonly inventory: Pick<
      InventoryProductionExpenseReportService,
      "read"
    >,
    private readonly renderers: Readonly<
      Record<ReportExportFormat, ReportExportRenderer>
    >,
    private readonly audit: Pick<AuditEventService, "record">,
  ) {}

  async export(
    input: ReportExportInput,
  ): Promise<Result<ReportExportResult, ReportExportError>> {
    const parsed = parseInput(input);
    if (parsed === null) return failure("INVALID_INPUT");

    const readInput = {
      actorId: parsed.actorId,
      restaurantId: parsed.restaurantId,
      date: parsed.date,
      timeZone: parsed.timeZone,
    };

    try {
      const results = await Promise.all([
        read(this.dailySales, readInput),
        read(this.operational, readInput),
        read(this.payments, readInput),
        read(this.inventory, readInput),
      ]);
      const failed = results.find((result) => !result.ok);
      if (failed && !failed.ok) return failure(failed.error.code);

      const [daily, operational, payments, inventory] = results;
      if (!daily.ok || !operational.ok || !payments.ok || !inventory.ok) {
        return failure("OPERATION_FAILED");
      }

      if (
        !aligned(
          daily.value,
          operational.value,
          payments.value,
          inventory.value,
        )
      ) {
        return failure("OPERATION_FAILED");
      }

      const document = buildReportExportDocument(
        daily.value,
        operational.value,
        payments.value,
        inventory.value,
      );
      const rendered = await this.renderers[parsed.format].render(document);
      if (
        !(rendered.bytes instanceof Uint8Array) ||
        rendered.bytes.length === 0
      ) {
        return failure("OPERATION_FAILED");
      }

      const audit = await this.audit.record({
        actorId: parsed.actorId,
        action: "report.export",
        entityType: "restaurant_report",
        entityId: parsed.restaurantId,
        newValues: {
          format: parsed.format,
          restaurantId: parsed.restaurantId,
          date: parsed.date,
          timeZone: parsed.timeZone,
          periodStart: document.periodStart,
          periodEnd: document.periodEnd,
          sections: document.sections.map((section) => section.title),
        },
      });
      if (!audit.ok) return failure("OPERATION_FAILED");

      return ok(
        Object.freeze({
          ...rendered,
          filename: `reporte-${parsed.date}.${rendered.extension}`,
        }),
      );
    } catch {
      return failure("OPERATION_FAILED");
    }
  }
}

async function read<T>(
  service: ReportReaderService<T>,
  input: DailySalesReportInput,
) {
  return service.read(input);
}

function parseInput(input: ReportExportInput) {
  if (!input || typeof input !== "object") return null;
  const keys = Object.keys(input);
  if (
    keys.length !== 5 ||
    !keys.every((key) =>
      ["actorId", "restaurantId", "date", "timeZone", "format"].includes(key),
    ) ||
    !REPORT_EXPORT_FORMATS.includes(input.format as ReportExportFormat)
  ) {
    return null;
  }
  const query = parseDailySalesReportQuery(input);
  return query === null
    ? null
    : Object.freeze({ ...query, format: input.format as ReportExportFormat });
}

function aligned(
  daily: DailySalesReport,
  operational: OperationalPerformanceReport,
  payments: PaymentReport,
  inventory: InventoryProductionExpenseReport,
) {
  const identity = [
    daily.restaurant.id,
    daily.restaurant.name,
    daily.date,
    daily.timeZone,
    daily.periodStart,
    daily.periodEnd,
  ].join("\u0000");
  return (
    [operational, payments, inventory].every(
      (report) =>
        [
          report.restaurant.id,
          report.restaurant.name,
          report.date,
          report.timeZone,
          report.periodStart,
          report.periodEnd,
        ].join("\u0000") === identity,
    ) && daily.totalRevenue === payments.totalRevenue
  );
}

const text = (value: unknown): ReportExportCell => ({
  value:
    value === null || value === undefined || value === "" ? "—" : String(value),
});
const number = (value: unknown): ReportExportCell => ({
  value: String(value),
  kind: "number",
});
const money = (value: string): ReportExportCell => ({ value, kind: "money" });
const row = (...cells: ReportExportCell[]) => cells;
const section = (
  title: string,
  columns: readonly string[],
  rows: readonly (readonly ReportExportCell[])[],
): ReportExportSection => ({ title, columns, rows });

const inventoryItemTypeLabels: Readonly<Record<string, string>> = Object.freeze(
  {
    RAW_INGREDIENT: "Ingrediente crudo",
    PRODUCED_ITEM: "Producto elaborado",
    RESALE_ITEM: "Producto de reventa",
  },
);
const inventoryMovementTypeLabels: Readonly<Record<string, string>> =
  Object.freeze({
    PURCHASE: "Compra",
    PRODUCTION_CONSUMPTION: "Consumo de producción",
    PRODUCTION_OUTPUT: "Salida de producción",
    SALE: "Venta",
    ADJUSTMENT: "Ajuste",
    WASTE: "Desperdicio",
    ROLLBACK: "Reversión",
  });
const inventoryOriginTypeLabels: Readonly<Record<string, string>> =
  Object.freeze({
    PURCHASE: "Compra",
    PRODUCTION: "Producción",
    SALE: "Venta",
    ADJUSTMENT: "Ajuste",
    WASTE: "Desperdicio",
    ROLLBACK: "Reversión",
  });
const expenseOriginTypeLabels: Readonly<Record<string, string>> = Object.freeze(
  {
    MANUAL: "Registro manual",
    PURCHASE: "Compra de inventario",
  },
);

function label(value: string, labels: Readonly<Record<string, string>>) {
  return labels[value] ?? "Tipo no reconocido";
}

export function buildReportExportDocument(
  daily: DailySalesReport,
  operational: OperationalPerformanceReport,
  payments: PaymentReport,
  inventory: InventoryProductionExpenseReport,
): ReportExportDocument {
  return Object.freeze({
    title: "Reporte operativo completo" as const,
    restaurant: daily.restaurant,
    date: daily.date,
    timeZone: daily.timeZone,
    periodStart: daily.periodStart,
    periodEnd: daily.periodEnd,
    sections: Object.freeze([
      section(
        "Resumen de ventas",
        ["Indicador", "Valor"],
        [
          row(text("Ingresos"), money(daily.totalRevenue)),
          row(text("Órdenes creadas"), number(daily.ordersCreated)),
          row(text("Órdenes completadas"), number(daily.ordersCompleted)),
          row(text("Ticket promedio"), money(daily.averageTicket)),
        ],
      ),
      section(
        "Ingresos por hora",
        ["Hora", "Ingresos"],
        daily.hourlyRevenue.map((entry) =>
          row(
            text(`${String(entry.hour).padStart(2, "0")}:00`),
            money(entry.amount),
          ),
        ),
      ),
      section(
        "Ventas por producto",
        ["Producto", "Cantidad", "Ingresos"],
        operational.productSales.map((entry) =>
          row(
            text(entry.productName),
            number(entry.quantitySold),
            money(entry.revenue),
          ),
        ),
      ),
      section(
        "Ventas por categoría",
        ["Categoría histórica", "Cantidad", "Ingresos"],
        operational.categorySales.map((entry) =>
          row(
            text(entry.categoryName),
            number(entry.quantitySold),
            money(entry.revenue),
          ),
        ),
      ),
      section(
        "Rendimiento de cocina y entrega",
        ["Indicador", "Valor"],
        [
          row(
            text("Preparación promedio (min)"),
            number(operational.averagePreparationMinutes),
          ),
          row(
            text("Preparación más larga (min)"),
            number(operational.longestPreparationMinutes),
          ),
          row(
            text("Órdenes en preparación"),
            number(operational.ordersCurrentlyInPreparation),
          ),
          row(
            text("Listo a en camino promedio (min)"),
            number(operational.averageReadyToOnTheWayMinutes),
          ),
          row(
            text("En camino a entregado promedio (min)"),
            number(operational.averageOnTheWayToDeliveredMinutes),
          ),
          row(text("Órdenes entregadas"), number(operational.deliveredOrders)),
          row(
            text("Órdenes esperando entrega"),
            number(operational.ordersWaitingForDelivery),
          ),
        ],
      ),
      section(
        "Órdenes en preparación por hora",
        ["Hora", "Órdenes"],
        operational.peakPreparationPeriods.map((entry) =>
          row(
            text(`${String(entry.hour).padStart(2, "0")}:00`),
            number(entry.orders),
          ),
        ),
      ),
      section(
        "Resumen de pagos",
        ["Indicador", "Valor"],
        [
          row(text("Ingresos cobrados"), money(payments.totalRevenue)),
          row(
            text("Saldo pendiente al cierre"),
            money(payments.totalOutstanding),
          ),
        ],
      ),
      section(
        "Ingresos por método de pago",
        ["Código", "Método", "Pagos", "Ingresos"],
        payments.revenueByMethod.map((entry) =>
          row(
            text(entry.paymentMethodCode),
            text(entry.paymentMethodName),
            number(entry.paymentCount),
            money(entry.amount),
          ),
        ),
      ),
      balanceSection(
        "Saldos pendientes al cierre",
        payments.outstandingBalances,
      ),
      balanceSection("Pagos parciales al cierre", payments.partialPayments),
      section(
        "Historial de pagos",
        [
          "Fecha y hora",
          "Orden",
          "Canasta",
          "Método",
          "Importe",
          "Referencia",
          "Comentarios",
          "Motivo de excedente",
        ],
        payments.paymentHistory.map((entry) =>
          row(
            text(entry.recordedAt),
            text(entry.orderNumber),
            text(entry.basketId),
            text(entry.paymentMethodName),
            money(entry.amount),
            text(entry.referenceNumber),
            text(entry.comments),
            text(entry.overageReason),
          ),
        ),
      ),
      section(
        "Existencias actuales",
        ["Artículo", "Tipo", "Existencia", "Unidad", "Mínimo", "Estado"],
        inventory.inventoryBalances.map((entry) =>
          row(
            text(entry.inventoryItemName),
            text(label(entry.inventoryItemType, inventoryItemTypeLabels)),
            number(entry.currentBalance),
            text(entry.unitOfMeasure),
            number(entry.minimumStockLevel),
            text(entry.isBelowMinimum ? "Bajo mínimo" : "Disponible"),
          ),
        ),
      ),
      section(
        "Alertas activas de stock",
        ["Artículo", "Observado", "Umbral", "Unidad", "Abierta"],
        inventory.activeAlerts.map((entry) =>
          row(
            text(entry.inventoryItemName),
            number(entry.observedBalance),
            number(entry.threshold),
            text(entry.unitOfMeasure),
            text(entry.openedAt),
          ),
        ),
      ),
      section(
        "Movimientos de inventario",
        [
          "Fecha y hora",
          "Artículo",
          "Tipo",
          "Cantidad",
          "Unidad",
          "Origen",
          "Comentarios",
        ],
        inventory.movements.map((entry) =>
          row(
            text(entry.recordedAt),
            text(entry.inventoryItemName),
            text(label(entry.type, inventoryMovementTypeLabels)),
            number(entry.quantityDelta),
            text(entry.unitOfMeasure),
            text(label(entry.businessOriginType, inventoryOriginTypeLabels)),
            text(entry.comments),
          ),
        ),
      ),
      section(
        "Compras",
        [
          "Fecha y hora",
          "Proveedor",
          "Categoría",
          "Artículo",
          "Cantidad",
          "Unidad",
          "Precio unitario",
          "Total de línea",
          "Total de compra",
        ],
        inventory.purchases.flatMap((purchase) =>
          purchase.lines.map((line) =>
            row(
              text(purchase.recordedAt),
              text(purchase.supplierName),
              text(purchase.expenseCategoryName),
              text(line.inventoryItemName),
              number(line.quantity),
              text(line.unitOfMeasure),
              money(line.unitPrice),
              money(line.lineTotal),
              money(purchase.totalAmount),
            ),
          ),
        ),
      ),
      section(
        "Producción completada",
        [
          "Fecha y hora",
          "Receta",
          "Versión",
          "Producto",
          "Cantidad",
          "Unidad",
          "Notas",
        ],
        inventory.productionBatches.map((entry) =>
          row(
            text(entry.completedAt),
            text(entry.recipeName),
            number(entry.recipeVersionNumber),
            text(entry.outputInventoryItemName),
            number(entry.producedQuantity),
            text(entry.unitOfMeasure),
            text(entry.notes),
          ),
        ),
      ),
      correctionSection("Ajustes", inventory.adjustments),
      correctionSection("Desperdicios", inventory.wasteRecords),
      section(
        "Resumen de gastos",
        ["Indicador", "Valor"],
        [
          row(text("Gastos del día"), money(inventory.dailyExpenseTotal)),
          row(text("Gastos del mes"), money(inventory.monthlyExpenseTotal)),
        ],
      ),
      section(
        "Detalle de gastos del día",
        [
          "Fecha",
          "Categoría",
          "Descripción",
          "Origen",
          "Importe",
          "Referencia",
          "Comentarios",
        ],
        inventory.expenses.map((entry) =>
          row(
            text(entry.incurredAt),
            text(entry.expenseCategoryName),
            text(entry.description),
            text(label(entry.originType, expenseOriginTypeLabels)),
            money(entry.amount),
            text(entry.referenceNumber),
            text(entry.comments),
          ),
        ),
      ),
      expenseCategorySection(
        "Gastos diarios por categoría",
        inventory.dailyExpensesByCategory,
      ),
      expenseCategorySection(
        "Gastos mensuales por categoría",
        inventory.monthlyExpensesByCategory,
      ),
      section(
        "Gastos mensuales por día",
        ["Fecha", "Importe"],
        inventory.monthlyExpensesByDay.map((entry) =>
          row(text(entry.date), money(entry.amount)),
        ),
      ),
    ]),
  });
}

function balanceSection(
  title: string,
  balances: PaymentReport["outstandingBalances"],
) {
  return section(
    title,
    ["Orden", "Canasta", "Total", "Pagado", "Pendiente"],
    balances.map((entry) =>
      row(
        text(entry.orderNumber),
        text(entry.basketId),
        money(entry.basketTotal),
        money(entry.paidAmount),
        money(entry.outstandingBalance),
      ),
    ),
  );
}

function correctionSection(
  title: string,
  entries: InventoryProductionExpenseReport["adjustments"],
) {
  return section(
    title,
    ["Fecha y hora", "Artículo", "Cantidad", "Unidad", "Motivo"],
    entries.map((entry) =>
      row(
        text(entry.recordedAt),
        text(entry.inventoryItemName),
        number(entry.quantity),
        text(entry.unitOfMeasure),
        text(entry.reason),
      ),
    ),
  );
}

function expenseCategorySection(
  title: string,
  entries: InventoryProductionExpenseReport["dailyExpensesByCategory"],
) {
  return section(
    title,
    ["Código", "Categoría", "Importe"],
    entries.map((entry) =>
      row(
        text(entry.expenseCategoryCode),
        text(entry.expenseCategoryName),
        money(entry.amount),
      ),
    ),
  );
}

function failure(code: ReportExportError["code"]) {
  return err(Object.freeze({ kind: "report-export-error" as const, code }));
}
