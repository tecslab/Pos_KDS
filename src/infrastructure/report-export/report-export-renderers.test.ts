import ExcelJS from "exceljs";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { ReportExportDocument } from "../../application";
import { PdfReportExportRenderer } from "./pdf-report-export-renderer";
import {
  safeText,
  XlsxReportExportRenderer,
} from "./xlsx-report-export-renderer";

const report = Object.freeze({
  title: "Reporte operativo completo",
  restaurant: Object.freeze({ id: "restaurant", name: "Carnales Centro" }),
  date: "2026-09-10",
  timeZone: "America/Guayaquil",
  periodStart: "2026-09-10T05:00:00.000Z",
  periodEnd: "2026-09-11T05:00:00.000Z",
  sections: Object.freeze([
    Object.freeze({
      title: "Resumen de ventas",
      columns: Object.freeze(["Indicador", "Valor"]),
      rows: Object.freeze([
        Object.freeze([
          Object.freeze({ value: "Ingresos" }),
          Object.freeze({ value: "125.50", kind: "money" as const }),
        ]),
        Object.freeze([
          Object.freeze({ value: "=CMD()" }),
          Object.freeze({ value: "7", kind: "number" as const }),
        ]),
      ]),
    }),
    Object.freeze({
      title: "Sin datos",
      columns: Object.freeze(["Valor"]),
      rows: Object.freeze([]),
    }),
  ]),
}) satisfies ReportExportDocument;

describe("report export renderers", () => {
  it("renders a valid paginatable PDF artifact", async () => {
    const first = "FILA-INICIAL-000";
    const last = "FILA-FINAL-199";
    const paginatedReport: ReportExportDocument = {
      ...report,
      sections: [
        {
          title: "Detalle completo",
          columns: ["Registro", "Total"],
          rows: Array.from({ length: 200 }, (_, index) => [
            {
              value:
                index === 0
                  ? first
                  : index === 199
                    ? last
                    : `FILA-${String(index).padStart(3, "0")}`,
            },
            { value: `${index}.25`, kind: "money" as const },
          ]),
        },
      ],
    };
    const result = await new PdfReportExportRenderer().render(paginatedReport);
    expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe("%PDF-");
    expect(result.contentType).toBe("application/pdf");
    const parsed = await PDFDocument.load(result.bytes);
    expect(parsed.getPageCount()).toBeGreaterThan(4);
    const content = parsed.context
      .enumerateIndirectObjects()
      .flatMap(([, object]) =>
        object instanceof PDFRawStream
          ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
          : [],
      )
      .join("\n");
    expect(content).toContain(toHex(first));
    expect(content).toContain(toHex(last));
    expect(content).toContain(toHex("Carnales Centro"));
    expect(content).toContain(toHex("America/Guayaquil"));
  });

  it("renders filters, numeric source values, Spanish sections and empty states to XLSX", async () => {
    const result = await new XlsxReportExportRenderer().render(report);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      result.bytes.buffer.slice(
        result.bytes.byteOffset,
        result.bytes.byteOffset + result.bytes.byteLength,
      ) as ArrayBuffer,
    );

    expect(workbook.getWorksheet("Filtros activos")?.getCell("B2").value).toBe(
      "Carnales Centro",
    );
    expect(workbook.getWorksheet("Filtros activos")?.getCell("B3").value).toBe(
      "2026-09-10",
    );
    expect(workbook.getWorksheet("Filtros activos")?.getCell("B4").value).toBe(
      "America/Guayaquil",
    );
    expect(workbook.getWorksheet("Filtros activos")?.getCell("B5").value).toBe(
      "2026-09-10T05:00:00.000Z",
    );
    expect(workbook.getWorksheet("Filtros activos")?.getCell("B6").value).toBe(
      "2026-09-11T05:00:00.000Z",
    );
    const summary = workbook.getWorksheet("Resumen de ventas");
    expect(summary?.getCell("B2").value).toBe(125.5);
    expect(summary?.getCell("B2").numFmt).toBe("$#,##0.00");
    expect(summary?.getCell("A3").value).toBe("'=CMD()");
    expect(workbook.getWorksheet("Sin datos")?.getCell("A2").value).toBe(
      "Sin registros",
    );
  });

  it("neutralizes spreadsheet formula prefixes", () => {
    expect(["=x", "+x", "-x", "@x"].map(safeText)).toEqual([
      "'=x",
      "'+x",
      "'-x",
      "'@x",
    ]);
    expect(safeText("texto")).toBe("texto");
  });
});

function toHex(value: string) {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}
