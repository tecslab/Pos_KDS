import ExcelJS from "exceljs";

import type {
  RenderedReportExport,
  ReportExportDocument,
  ReportExportRenderer,
} from "../../application";

export class XlsxReportExportRenderer implements ReportExportRenderer {
  async render(document: ReportExportDocument): Promise<RenderedReportExport> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Carnales";
    workbook.created = new Date(0);
    workbook.modified = new Date(0);

    const summary = workbook.addWorksheet("Filtros activos");
    summary.addRows([
      [document.title],
      ["Restaurante", safeText(document.restaurant.name)],
      ["Fecha seleccionada", document.date],
      ["Zona horaria", document.timeZone],
      ["Inicio del periodo", document.periodStart],
      ["Fin del periodo", document.periodEnd],
    ]);
    summary.getRow(1).font = { bold: true, size: 16 };
    summary.getColumn(1).width = 24;
    summary.getColumn(2).width = 44;

    const usedNames = new Set<string>(["Filtros activos"]);
    for (const section of document.sections) {
      const worksheet = workbook.addWorksheet(
        sheetName(section.title, usedNames),
      );
      worksheet.addRow(section.columns.map(safeText));
      worksheet.getRow(1).font = { bold: true };
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
      if (section.rows.length === 0) {
        worksheet.addRow(["Sin registros"]);
      } else {
        for (const row of section.rows) {
          const worksheetRow = worksheet.addRow(
            row.map((cell) =>
              cell.kind === "money" || cell.kind === "number"
                ? Number(cell.value)
                : safeText(cell.value),
            ),
          );
          row.forEach((cell, index) => {
            if (cell.kind === "money")
              worksheetRow.getCell(index + 1).numFmt = "$#,##0.00";
            if (cell.kind === "number")
              worksheetRow.getCell(index + 1).numFmt = "0.###";
          });
        }
      }
      worksheet.columns.forEach((column) => {
        let width = 12;
        column.eachCell?.({ includeEmpty: true }, (cell) => {
          width = Math.max(
            width,
            Math.min(44, String(cell.value ?? "").length + 2),
          );
        });
        column.width = width;
      });
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: Math.max(1, section.columns.length) },
      };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Object.freeze({
      bytes: new Uint8Array(buffer),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: "xlsx" as const,
    });
  }
}

export function safeText(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function sheetName(value: string, usedNames: Set<string>) {
  const base = value.replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || "Reporte";
  let name = base;
  let suffix = 2;
  while (usedNames.has(name)) {
    const ending = ` ${suffix}`;
    name = `${base.slice(0, 31 - ending.length)}${ending}`;
    suffix += 1;
  }
  usedNames.add(name);
  return name;
}
