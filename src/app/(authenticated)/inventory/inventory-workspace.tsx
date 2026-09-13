"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { InventoryViews } from "@/application";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../../../lib/observability/recorder";

import {
  InventoryRealtimeController,
  parseInventoryViewsPayload,
  type InventoryConnectionStatus,
} from "./inventory-display";

type InventoryWorkspaceProps = Readonly<{ initialViews: InventoryViews }>;

const connectionPresentation: Readonly<
  Record<InventoryConnectionStatus, string>
> = Object.freeze({
  connecting: "Conectando actualizaciones en vivo",
  live: "Recibiendo actualizaciones en vivo",
  degraded: "Conexión interrumpida · actualización periódica activa",
});

export function InventoryWorkspace({ initialViews }: InventoryWorkspaceProps) {
  const [views, setViews] = useState(initialViews);
  const [connection, setConnection] =
    useState<InventoryConnectionStatus>("connecting");
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestAbort = useRef<AbortController | null>(null);
  const realtime = useRef<InventoryRealtimeController | null>(null);
  const restaurantIds = useMemo(
    () => [
      ...new Set(initialViews.balances.map((balance) => balance.restaurantId)),
    ],
    [initialViews.balances],
  );

  const refreshInventory = useCallback(async () => {
    requestAbort.current?.abort();
    const controller = new AbortController();
    requestAbort.current = controller;
    setRefreshing(true);
    try {
      const response = await fetch("/api/v1/inventory", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Inventory request failed.");
      const parsed = parseInventoryViewsPayload(await response.json());
      if (parsed === null) throw new Error("Inventory response was invalid.");
      setViews(parsed);
      setLoadError(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadError(
        "No se pudo actualizar el inventario. Se conserva la última información disponible.",
      );
      throw error;
    } finally {
      if (requestAbort.current === controller) {
        requestAbort.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let importFallback: number | undefined;
    async function connect() {
      try {
        const [
          { createBrowserSupabaseClient },
          { SupabaseRealtimeSubscriber },
        ] = await Promise.all([
          import("../../../lib/supabase"),
          import("../../../infrastructure/realtime"),
        ]);
        if (disposed) return;
        const controller = new InventoryRealtimeController({
          subscriber: new SupabaseRealtimeSubscriber(
            createBrowserSupabaseClient(),
            operationalTelemetry,
            operationalTelemetryClock,
          ),
          restaurantIds,
          refreshInventory,
          onStatus: setConnection,
        });
        realtime.current = controller;
        await controller.start();
      } catch {
        if (disposed) return;
        setConnection("degraded");
        void refreshInventory().catch(() => undefined);
        importFallback = window.setInterval(
          () => void refreshInventory().catch(() => undefined),
          5_000,
        );
      }
    }
    void connect();
    return () => {
      disposed = true;
      requestAbort.current?.abort();
      if (importFallback !== undefined) window.clearInterval(importFallback);
      const controller = realtime.current;
      realtime.current = null;
      if (controller !== null) void controller.stop();
    };
  }, [refreshInventory, restaurantIds]);

  const manuallyRefresh = () => {
    const controller = realtime.current;
    void (
      controller === null ? refreshInventory() : controller.refreshNow()
    ).catch(() => undefined);
  };

  return (
    <section aria-label="Estado actual del inventario">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-lg bg-[var(--color-text)] p-5 text-white shadow-[var(--shadow-sm)]">
        <div>
          <p className="text-sm font-semibold text-[var(--status-new-bg)]">
            Inventario
          </p>
          <h1 className="mt-1 text-3xl font-bold">Saldos y movimientos</h1>
          <p className="mt-2 text-sm text-white/80">
            Consulta saldos derivados del historial inmutable y alertas activas.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p
            role="status"
            aria-live="polite"
            className="max-w-52 text-right text-sm text-white/80"
          >
            {connectionPresentation[connection]}
          </p>
          <button
            type="button"
            onClick={manuallyRefresh}
            disabled={refreshing}
            className="min-h-12 rounded-md border border-white/60 bg-white px-4 font-semibold text-[var(--color-text)] disabled:cursor-wait disabled:opacity-70"
          >
            {refreshing ? "Actualizando…" : "Actualizar inventario"}
          </button>
        </div>
      </header>

      {loadError !== null ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-4 font-semibold text-[var(--status-critical)]"
        >
          {loadError}
        </p>
      ) : null}

      <section
        className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]"
        aria-labelledby="inventory-alerts-title"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-border)] p-5">
          <div>
            <h2 id="inventory-alerts-title" className="text-xl font-bold">
              Alertas de bajo inventario
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Los artículos aparecen cuando su saldo está por debajo del mínimo
              configurado.
            </p>
          </div>
          <span className="rounded-sm bg-[var(--status-warning-bg)] px-2 py-1 text-sm font-bold text-[var(--status-warning)]">
            {views.activeAlerts.length} activas
          </span>
        </div>
        {views.activeAlerts.length === 0 ? (
          <p className="p-5 text-[var(--color-text-muted)]">
            No hay alertas de bajo inventario activas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Artículo</th>
                  <th className="px-4 py-3 font-semibold">Saldo observado</th>
                  <th className="px-4 py-3 font-semibold">Mínimo</th>
                  <th className="px-4 py-3 font-semibold">Abierta</th>
                </tr>
              </thead>
              <tbody>
                {views.activeAlerts.map((alert) => (
                  <tr
                    key={alert.id}
                    className="border-t border-[var(--color-border)]"
                  >
                    <td className="px-4 py-3 font-semibold">
                      {alert.inventoryItemName}
                      <span className="block font-normal text-[var(--color-text-muted)]">
                        {alert.restaurantName}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold tabular-nums text-[var(--status-warning)]">
                      {formatQuantity(
                        alert.observedBalance,
                        alert.unitOfMeasure,
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatQuantity(alert.threshold, alert.unitOfMeasure)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatDateTime(alert.openedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]"
        aria-labelledby="inventory-balances-title"
      >
        <div className="border-b border-[var(--color-border)] p-5">
          <h2 id="inventory-balances-title" className="text-xl font-bold">
            Saldos actuales
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Cada saldo se calcula a partir de movimientos registrados, no se
            edita directamente.
          </p>
        </div>
        {views.balances.length === 0 ? (
          <p className="p-5 text-[var(--color-text-muted)]">
            Todavía no hay artículos de inventario configurados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="min-w-full text-left text-sm"
              aria-label="Saldos actuales de inventario"
            >
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Artículo</th>
                  <th className="px-4 py-3 font-semibold">Tipo</th>
                  <th className="px-4 py-3 font-semibold">Saldo</th>
                  <th className="px-4 py-3 font-semibold">Mínimo</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {views.balances.map((balance) => (
                  <tr
                    key={`${balance.restaurantId}:${balance.inventoryItemId}`}
                    className="border-t border-[var(--color-border)]"
                  >
                    <td className="px-4 py-3 font-semibold">
                      {balance.inventoryItemName}
                      <span className="block font-normal text-[var(--color-text-muted)]">
                        {balance.restaurantName}
                      </span>
                    </td>
                    <td className="px-4 py-3">{balance.inventoryItemType}</td>
                    <td className="px-4 py-3 font-bold tabular-nums">
                      {formatQuantity(
                        balance.currentBalance,
                        balance.unitOfMeasure,
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatQuantity(
                        balance.minimumStockLevel,
                        balance.unitOfMeasure,
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {balance.isBelowMinimum ? (
                        <span className="rounded-sm bg-[var(--status-warning-bg)] px-2 py-1 font-semibold text-[var(--status-warning)]">
                          Bajo mínimo
                        </span>
                      ) : (
                        <span className="rounded-sm bg-[var(--status-new-bg)] px-2 py-1 font-semibold text-[var(--status-new)]">
                          En rango
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]"
        aria-labelledby="inventory-movements-title"
      >
        <div className="border-b border-[var(--color-border)] p-5">
          <h2 id="inventory-movements-title" className="text-xl font-bold">
            Historial inmutable de movimientos
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Cada registro conserva responsable, momento, origen comercial y
            comentario.
          </p>
        </div>
        {views.movements.length === 0 ? (
          <p className="p-5 text-[var(--color-text-muted)]">
            Aún no hay movimientos de inventario registrados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="min-w-[900px] text-left text-sm"
              aria-label="Historial inmutable de movimientos"
            >
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Fecha</th>
                  <th className="px-4 py-3 font-semibold">Artículo</th>
                  <th className="px-4 py-3 font-semibold">Cambio</th>
                  <th className="px-4 py-3 font-semibold">Tipo</th>
                  <th className="px-4 py-3 font-semibold">Responsable</th>
                  <th className="px-4 py-3 font-semibold">Origen comercial</th>
                  <th className="px-4 py-3 font-semibold">Comentarios</th>
                </tr>
              </thead>
              <tbody>
                {views.movements.map((movement) => (
                  <tr
                    key={movement.id}
                    className="border-t border-[var(--color-border)] align-top"
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                      {formatDateTime(movement.recordedAt)}
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      {movement.inventoryItemName}
                      <span className="block font-normal text-[var(--color-text-muted)]">
                        {movement.restaurantName}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3 font-bold tabular-nums ${movement.quantityDelta.startsWith("-") ? "text-[var(--status-critical)]" : "text-[var(--status-new)]"}`}
                    >
                      {formatQuantity(
                        movement.quantityDelta,
                        movement.unitOfMeasure,
                      )}
                    </td>
                    <td className="px-4 py-3">{movement.type}</td>
                    <td className="px-4 py-3">
                      {movement.recordedBy.displayName}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold">
                        {movement.businessOrigin.type}
                      </span>
                      <code
                        className="block max-w-44 truncate text-xs text-[var(--color-text-muted)]"
                        title={movement.businessOrigin.id}
                      >
                        {movement.businessOrigin.id}
                      </code>
                      {movement.reversedMovementId ? (
                        <span className="block text-xs text-[var(--color-text-muted)]">
                          Reversión registrada
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-64 px-4 py-3 text-[var(--color-text-muted)]">
                      {movement.comments ?? "Sin comentarios"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

function formatQuantity(quantity: string, unit: string) {
  return `${quantity} ${unit}`;
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
