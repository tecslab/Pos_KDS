import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import type {
  RenderedReportExport,
  ReportExportDocument,
  ReportExportRenderer,
} from "../../application";

const pageWidth = 842;
const pageHeight = 595;
const margin = 36;
const bodySize = 8;
const lineHeight = 11;

export class PdfReportExportRenderer implements ReportExportRenderer {
  async render(document: ReportExportDocument): Promise<RenderedReportExport> {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    const addPage = () => {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    };
    const writeLine = (
      value: string,
      options?: { bold?: boolean; size?: number },
    ) => {
      const size = options?.size ?? bodySize;
      if (y < margin + lineHeight) addPage();
      page.drawText(toPdfText(value), {
        x: margin,
        y,
        size,
        font: options?.bold ? bold : regular,
        color: rgb(0.12, 0.15, 0.13),
      });
      y -= size + 4;
    };

    writeLine(document.title, { bold: true, size: 17 });
    writeLine(`Restaurante: ${document.restaurant.name}`);
    writeLine(`Fecha seleccionada: ${document.date}`);
    writeLine(`Zona horaria: ${document.timeZone}`);
    writeLine(`Periodo: ${document.periodStart} a ${document.periodEnd}`);
    y -= 8;

    for (const section of document.sections) {
      if (y < margin + 50) addPage();
      writeLine(section.title, { bold: true, size: 12 });
      writeWrappedRow(page, section.columns, bold, y);
      y -= wrappedHeight(section.columns);
      const rows =
        section.rows.length === 0
          ? [[{ value: "Sin registros" }]]
          : section.rows;
      for (const exportRow of rows) {
        const values = exportRow.map((cell) =>
          displayValue(cell.value, cell.kind),
        );
        const height = wrappedHeight(values);
        if (y < margin + height) addPage();
        writeWrappedRow(page, values, regular, y);
        y -= height;
      }
      y -= 8;
    }

    const bytes = await pdf.save({ useObjectStreams: false });
    return Object.freeze({
      bytes,
      contentType: "application/pdf",
      extension: "pdf" as const,
    });
  }
}

function writeWrappedRow(
  page: PDFPage,
  values: readonly (string | { value: string })[],
  font: PDFFont,
  y: number,
) {
  const text = values
    .map((value) => (typeof value === "string" ? value : value.value))
    .join(" | ");
  splitLine(toPdfText(text)).forEach((line, index) => {
    page.drawText(line, {
      x: margin,
      y: y - index * lineHeight,
      size: bodySize,
      font,
    });
  });
}

function wrappedHeight(values: readonly (string | { value: string })[]) {
  const text = values
    .map((value) => (typeof value === "string" ? value : value.value))
    .join(" | ");
  return splitLine(toPdfText(text)).length * lineHeight + 3;
}

function splitLine(value: string) {
  const max = 145;
  if (value.length <= max) return [value];
  const lines: string[] = [];
  let remaining = value;
  while (remaining.length > max) {
    const boundary = remaining.lastIndexOf(" ", max);
    const end = boundary > 40 ? boundary : max;
    lines.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) lines.push(remaining);
  return lines;
}

function displayValue(value: string, kind?: "money" | "number") {
  if (kind === "money") return `$${value}`;
  return value;
}

function toPdfText(value: string) {
  // Standard PDF fonts support Latin-1/WinAnsi. Replace only unsupported
  // controls and glyphs so persisted Spanish labels remain legible.
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[^\u0020-\u00ff]/g, "?");
}
