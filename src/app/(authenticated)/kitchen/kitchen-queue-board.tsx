"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { KitchenQueueOrder } from "@/application";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../../../lib/observability/recorder";

import {
  elapsedMilliseconds,
  formatElapsedTime,
  kitchenPriority,
  KitchenQueueRealtimeController,
  parseKitchenQueuePayload,
  parseKitchenReadyResult,
  type KitchenConnectionStatus,
  type KitchenPriority,
  type KitchenThresholds,
} from "./kitchen-display";

type KitchenQueueBoardProps = Readonly<{
  initialOrders: readonly KitchenQueueOrder[];
  thresholds: readonly KitchenThresholds[];
  canMarkReady: boolean;
}>;

const priorityPresentation: Readonly<
  Record<
    KitchenPriority,
    Readonly<{ label: string; cardClass: string; badgeClass: string }>
  >
> = Object.freeze({
  normal: Object.freeze({
    label: "En tiempo",
    cardClass: "border-l-[var(--status-new)]",
    badgeClass: "bg-[var(--status-new-bg)] text-[var(--status-new)]",
  }),
  warning: Object.freeze({
    label: "Advertencia",
    cardClass: "border-l-[var(--status-warning)]",
    badgeClass: "bg-[var(--status-warning-bg)] text-[var(--status-warning)]",
  }),
  critical: Object.freeze({
    label: "Crítica",
    cardClass: "border-l-[var(--status-critical)]",
    badgeClass: "bg-[var(--status-critical-bg)] text-[var(--status-critical)]",
  }),
});

const connectionPresentation: Readonly<
  Record<KitchenConnectionStatus, string>
> = Object.freeze({
  connecting: "Conectando actualizaciones en vivo",
  live: "Recibiendo órdenes en vivo",
  degraded: "Conexión interrumpida · actualización periódica activa",
});

export function KitchenQueueBoard({
  initialOrders,
  thresholds,
  canMarkReady,
}: KitchenQueueBoardProps) {
  const [orders, setOrders] = useState(initialOrders);
  const [now, setNow] = useState(0);
  const [connection, setConnection] =
    useState<KitchenConnectionStatus>("connecting");
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markingReady, setMarkingReady] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [readyErrors, setReadyErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const requestAbort = useRef<AbortController | null>(null);
  const realtime = useRef<KitchenQueueRealtimeController | null>(null);
  const thresholdByRestaurant = useMemo(
    () => new Map(thresholds.map((entry) => [entry.restaurantId, entry])),
    [thresholds],
  );

  const refreshQueue = useCallback(async () => {
    const controller = new AbortController();
    requestAbort.current = controller;
    setRefreshing(true);

    try {
      const response = await fetch("/api/v1/kitchen/orders", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Kitchen queue request failed.");

      const parsed = parseKitchenQueuePayload(await response.json());
      if (
        parsed === null ||
        parsed.some((order) => !thresholdByRestaurant.has(order.restaurantId))
      ) {
        throw new Error("Kitchen queue response was invalid.");
      }

      setOrders(parsed);
      setLoadError(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadError(
        "No se pudo actualizar la cola. Se conserva la última información disponible.",
      );
      throw error;
    } finally {
      if (requestAbort.current === controller) {
        requestAbort.current = null;
        setRefreshing(false);
      }
    }
  }, [thresholdByRestaurant]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
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
          import("@/lib/supabase/client"),
          import("@/infrastructure/realtime"),
        ]);
        if (disposed) return;

        const controller = new KitchenQueueRealtimeController({
          subscriber: new SupabaseRealtimeSubscriber(
            createBrowserSupabaseClient(),
            operationalTelemetry,
            operationalTelemetryClock,
          ),
          restaurantIds: thresholds.map((entry) => entry.restaurantId),
          refreshQueue,
          onStatus: setConnection,
        });
        realtime.current = controller;
        await controller.start();
      } catch {
        if (disposed) return;
        setConnection("degraded");
        void refreshQueue().catch(() => undefined);
        importFallback = window.setInterval(() => {
          void refreshQueue().catch(() => undefined);
        }, 5_000);
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
  }, [refreshQueue, thresholds]);

  const manuallyRefresh = () => {
    const controller = realtime.current;
    void (controller === null ? refreshQueue() : controller.refreshNow()).catch(
      () => undefined,
    );
  };

  const markReady = useCallback(async (orderId: string) => {
    setMarkingReady((current) => new Set(current).add(orderId));
    setReadyErrors((current) => withoutKey(current, orderId));

    try {
      const response = await fetch(`/api/v1/kitchen/orders/${orderId}`, {
        method: "PATCH",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Ready transition failed.");

      const result = parseKitchenReadyResult(await response.json(), orderId);
      if (result === null) throw new Error("Ready response was invalid.");

      setOrders((current) => current.filter((order) => order.id !== orderId));
    } catch {
      setReadyErrors((current) => ({
        ...current,
        [orderId]: "No se pudo marcar la orden como lista. Intenta nuevamente.",
      }));
    } finally {
      setMarkingReady((current) => {
        const next = new Set(current);
        next.delete(orderId);
        return next;
      });
    }
  }, []);

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-lg bg-[var(--color-text)] p-5 text-white shadow-[var(--shadow-sm)]">
        <div>
          <p className="text-sm font-semibold text-[var(--status-new-bg)]">
            Sistema de visualización de cocina
          </p>
          <h1 className="mt-1 text-3xl font-bold">Cola de cocina</h1>
          <p className="mt-2 text-sm text-white/80">
            Órdenes pendientes en orden de confirmación.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="text-right">
            <p className="text-xl font-bold tabular-nums">
              {orders.length} {orders.length === 1 ? "activa" : "activas"}
            </p>
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="text-sm text-white/80"
            >
              {connectionPresentation[connection]} · {orders.length}{" "}
              {orders.length === 1 ? "orden activa" : "órdenes activas"}
            </p>
          </div>
          <button
            type="button"
            onClick={manuallyRefresh}
            disabled={refreshing}
            className="min-h-12 rounded-md border border-white/60 bg-white px-4 font-semibold text-[var(--color-text)] disabled:cursor-wait disabled:opacity-70"
          >
            {refreshing ? "Actualizando…" : "Actualizar cola"}
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

      {orders.length === 0 ? (
        <section className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-[var(--shadow-sm)]">
          <h2 className="text-xl font-bold">La cocina está al día</h2>
          <p className="mt-2 text-[var(--color-text-muted)]">
            Las nuevas órdenes confirmadas aparecerán aquí automáticamente.
          </p>
        </section>
      ) : (
        <section
          aria-busy={refreshing}
          aria-label="Órdenes pendientes de cocina"
          className="mt-5 grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--kds-card-min)),1fr))]"
        >
          {orders.map((order) => {
            const configuredThresholds = thresholdByRestaurant.get(
              order.restaurantId,
            )!;
            return (
              <KitchenOrderCard
                key={order.id}
                order={order}
                now={now}
                thresholds={configuredThresholds}
                canMarkReady={canMarkReady}
                isMarkingReady={markingReady.has(order.id)}
                readyError={readyErrors[order.id] ?? null}
                onMarkReady={markReady}
              />
            );
          })}
        </section>
      )}
    </div>
  );
}

function KitchenOrderCard({
  order,
  now,
  thresholds,
  canMarkReady,
  isMarkingReady,
  readyError,
  onMarkReady,
}: Readonly<{
  order: KitchenQueueOrder;
  now: number;
  thresholds: KitchenThresholds;
  canMarkReady: boolean;
  isMarkingReady: boolean;
  readyError: string | null;
  onMarkReady(orderId: string): void;
}>) {
  const elapsed = elapsedMilliseconds(order.createdAt, now);
  const priority = kitchenPriority(order.createdAt, now, thresholds);
  const presentation = priorityPresentation[priority];

  return (
    <article
      aria-label={`Orden ${order.orderNumber}, ${presentation.label}`}
      className={`overflow-hidden rounded-lg border border-l-4 border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)] ${presentation.cardClass}`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4">
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-bold tabular-nums">
            {order.orderNumber}
          </h2>
          <p className="mt-1 text-lg font-semibold">
            {order.serviceLocation.name}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Creada a las{" "}
            <time dateTime={order.createdAt} suppressHydrationWarning>
              {formatCreatedAt(order.createdAt)}
            </time>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span
            className={`inline-block rounded-sm px-2 py-1 text-xs font-bold uppercase ${presentation.badgeClass}`}
          >
            {presentation.label}
          </span>
          <p
            aria-label={`Antigüedad de la orden: ${formatElapsedTime(elapsed)}`}
            className="mt-2 text-xl font-bold tabular-nums"
          >
            {formatElapsedTime(elapsed)}
          </p>
        </div>
      </header>

      <ul className="divide-y divide-[var(--color-border)]">
        {order.lines.map((line) => (
          <li key={line.id} className="grid grid-cols-[3rem_1fr] gap-3 p-4">
            <span
              aria-label={`Cantidad: ${line.quantity}`}
              className="text-center text-2xl font-bold tabular-nums text-[var(--brand-green)]"
            >
              {line.quantity}×
            </span>
            <div className="min-w-0">
              <h3 className="text-lg font-bold leading-6">
                {line.productName}
              </h3>
              {line.selectedOptions.length > 0 ? (
                <p className="mt-2 rounded-sm bg-[var(--color-surface-muted)] px-2 py-1 text-sm font-semibold">
                  Opciones:{" "}
                  {line.selectedOptions.map(({ name }) => name).join(", ")}
                </p>
              ) : null}
              {line.removedIngredients.length > 0 ? (
                <p className="mt-2 rounded-sm bg-[var(--status-warning-bg)] px-2 py-1 text-sm font-bold text-[var(--status-warning)]">
                  Sin:{" "}
                  {line.removedIngredients.map(({ name }) => name).join(", ")}
                </p>
              ) : null}
              {line.observations?.trim() ? (
                <p className="mt-2 border-l-2 border-[var(--status-info)] pl-2 text-sm font-semibold">
                  Observación: {line.observations}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {canMarkReady ? (
        <footer className="border-t border-[var(--color-border)] p-4">
          {readyError !== null ? (
            <p
              id={`ready-error-${order.id}`}
              role="alert"
              className="mb-3 rounded-sm bg-[var(--status-critical-bg)] p-2 text-sm font-semibold text-[var(--status-critical)]"
            >
              {readyError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => onMarkReady(order.id)}
            disabled={isMarkingReady}
            aria-describedby={
              readyError === null ? undefined : `ready-error-${order.id}`
            }
            className="min-h-12 w-full rounded-md bg-[var(--brand-green)] px-4 text-lg font-bold text-white disabled:cursor-wait disabled:opacity-70"
          >
            {isMarkingReady ? "Marcando…" : "Listo"}
          </button>
        </footer>
      ) : null}
    </article>
  );
}

function withoutKey(
  value: Readonly<Record<string, string>>,
  key: string,
): Readonly<Record<string, string>> {
  const next = { ...value };
  delete next[key];
  return next;
}

function formatCreatedAt(createdAt: string): string {
  return new Intl.DateTimeFormat("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(createdAt));
}
