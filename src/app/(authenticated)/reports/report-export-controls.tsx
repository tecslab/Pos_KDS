"use client";

import { useState } from "react";

import type { ReportExportFormat } from "@/application";

type ReportExportControlsProps = Readonly<{
  restaurantId: string;
  date: string;
  timeZone: string;
}>;

export function ReportExportControls({
  restaurantId,
  date,
  timeZone,
}: ReportExportControlsProps) {
  const [busyFormat, setBusyFormat] = useState<ReportExportFormat | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const download = async (format: ReportExportFormat) => {
    if (busyFormat !== null) return;
    setBusyFormat(format);
    setFailed(false);
    setMessage(`Preparando archivo ${format === "pdf" ? "PDF" : "Excel"}…`);

    try {
      const response = await fetch("/api/v1/reports/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, date, timeZone, format }),
      });
      if (!response.ok) throw new Error("export-failed");

      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `reporte-${date}.${format}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage("La descarga está lista.");
    } catch {
      setFailed(true);
      setMessage("No se pudo exportar el reporte. Inténtalo nuevamente.");
    } finally {
      setBusyFormat(null);
    }
  };

  return (
    <section
      aria-labelledby="report-export-title"
      className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4"
    >
      <h2 id="report-export-title" className="text-base font-bold">
        Exportar reporte
      </h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Descarga todos los datos y filtros del reporte consultado.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <ExportButton
          format="pdf"
          label="Descargar PDF"
          busyFormat={busyFormat}
          onDownload={download}
        />
        <ExportButton
          format="xlsx"
          label="Descargar Excel"
          busyFormat={busyFormat}
          onDownload={download}
        />
      </div>
      <p
        id="report-export-status"
        role={failed ? "alert" : "status"}
        aria-live="polite"
        className={`mt-3 min-h-5 text-sm ${failed ? "text-[var(--status-critical)]" : "text-[var(--color-text-muted)]"}`}
      >
        {message}
      </p>
    </section>
  );
}

function ExportButton({
  format,
  label,
  busyFormat,
  onDownload,
}: Readonly<{
  format: ReportExportFormat;
  label: string;
  busyFormat: ReportExportFormat | null;
  onDownload(format: ReportExportFormat): Promise<void>;
}>) {
  const busy = busyFormat === format;
  return (
    <button
      type="button"
      disabled={busyFormat !== null}
      aria-describedby="report-export-status"
      aria-busy={busy}
      onClick={() => void onDownload(format)}
      className="min-h-12 rounded-md border border-[var(--brand-green)] bg-white px-5 font-semibold text-[var(--brand-green)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
    >
      {busy ? "Preparando…" : label}
    </button>
  );
}
