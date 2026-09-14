"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DeliveryQueueItem } from "@/application";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../../../lib/observability/recorder";

import {
  DeliveryQueueRealtimeController,
  elapsedMilliseconds,
  formatWaitingTime,
  deliveryPriority,
  parseDeliveryQueuePayload,
  queryForDeliveryFilters,
  type DeliveryConnectionStatus,
  type DeliveryFilters,
  type DeliveryPriority,
  type DeliveryThresholds,
} from "./delivery-display";

type DeliveryQueueBoardProps = Readonly<{
  initialOrders: readonly DeliveryQueueItem[];
  thresholds: readonly DeliveryThresholds[];
}>;

const emptyFilters: DeliveryFilters = Object.freeze({
  serviceLocationId: "",
  orderNumber: "",
  minimumWaitingMinutes: "",
});

const priorityPresentation: Readonly<
  Record<
    DeliveryPriority,
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
  Record<DeliveryConnectionStatus, string>
> = Object.freeze({
  connecting: "Conectando actualizaciones en vivo",
  live: "Recibiendo actualizaciones en vivo",
  degraded: "Conexión interrumpida · actualización periódica activa",
});

export function DeliveryQueueBoard({
  initialOrders,
  thresholds,
}: DeliveryQueueBoardProps) {
  const [orders, setOrders] = useState(initialOrders);
  const [now, setNow] = useState(0);
  const [connection, setConnection] =
    useState<DeliveryConnectionStatus>("connecting");
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] =
    useState<DeliveryFilters>(emptyFilters);
  const [activeFilters, setActiveFilters] =
    useState<DeliveryFilters>(emptyFilters);
  const requestAbort = useRef<AbortController | null>(null);
  const realtime = useRef<DeliveryQueueRealtimeController | null>(null);
  const thresholdByRestaurant = useMemo(
    () => new Map(thresholds.map((entry) => [entry.restaurantId, entry])),
    [thresholds],
  );
  const locations = useMemo(() => {
    const unique = new Map<string, DeliveryQueueItem["serviceLocation"]>();
    for (const order of [...initialOrders, ...orders]) {
      unique.set(order.serviceLocation.id, order.serviceLocation);
    }
    return [...unique.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [initialOrders, orders]);

  const refreshQueue = useCallback(async () => {
    const query = queryForDeliveryFilters(activeFilters);
    if (query === null) throw new Error("Delivery filters were invalid.");

    const controller = new AbortController();
    requestAbort.current = controller;
    setRefreshing(true);

    try {
      const response = await fetch(`/api/v1/delivery/orders${query}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Delivery queue request failed.");

      const parsed = parseDeliveryQueuePayload(await response.json());
      if (
        parsed === null ||
        parsed.some((order) => !thresholdByRestaurant.has(order.restaurantId))
      ) {
        throw new Error("Delivery queue response was invalid.");
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
  }, [activeFilters, thresholdByRestaurant]);

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

        const controller = new DeliveryQueueRealtimeController({
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

  const applyFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (queryForDeliveryFilters(draftFilters) === null) {
      setFilterError("Revisa el tiempo de espera antes de filtrar.");
      return;
    }
    setFilterError(null);
    setActiveFilters(draftFilters);
  };

  const clearFilters = () => {
    setDraftFilters(emptyFilters);
    setActiveFilters(emptyFilters);
    setFilterError(null);
  };

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-lg bg-[var(--color-text)] p-5 text-white shadow-[var(--shadow-sm)]">
        <div>
          <p className="text-sm font-semibold text-[var(--status-new-bg)]">
            Panel de entrega
          </p>
          <h1 className="mt-1 text-3xl font-bold">Órdenes listas</h1>
          <p className="mt-2 text-sm text-white/80">
            Entrega las órdenes preparadas, en orden de espera.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="text-right">
            <p className="text-xl font-bold tabular-nums">
              {orders.length} {orders.length === 1 ? "lista" : "listas"}
            </p>
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="text-sm text-white/80"
            >
              {connectionPresentation[connection]} · {orders.length}{" "}
              {orders.length === 1 ? "orden lista" : "órdenes listas"}
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

      <form
        onSubmit={applyFilters}
        className="mt-5 grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-sm)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,10rem)_max-content_max-content]"
        aria-label="Filtros de órdenes listas"
      >
        <label className="min-w-0 grid gap-1 text-sm font-semibold">
          Mesa o ubicación
          <select
            value={draftFilters.serviceLocationId}
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                serviceLocationId: event.target.value,
              }))
            }
            className="min-h-12 w-full rounded-md border border-[var(--color-border-strong)] bg-white px-3 text-base focus:outline-2 focus:outline-offset-2 focus:outline-[var(--brand-green)]"
          >
            <option value="">Todas las mesas</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 grid gap-1 text-sm font-semibold">
          Número de orden
          <input
            value={draftFilters.orderNumber}
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                orderNumber: event.target.value,
              }))
            }
            maxLength={100}
            className="min-h-12 w-full rounded-md border border-[var(--color-border-strong)] bg-white px-3 text-base focus:outline-2 focus:outline-offset-2 focus:outline-[var(--brand-green)]"
          />
        </label>
        <label className="min-w-0 grid gap-1 text-sm font-semibold">
          Espera mínima
          <span className="relative">
            <input
              value={draftFilters.minimumWaitingMinutes}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  minimumWaitingMinutes: event.target.value,
                }))
              }
              inputMode="numeric"
              pattern="[0-9]*"
              aria-describedby={
                filterError === null ? undefined : "delivery-filter-error"
              }
              className="min-h-12 w-full rounded-md border border-[var(--color-border-strong)] bg-white px-3 pr-10 text-base tabular-nums focus:outline-2 focus:outline-offset-2 focus:outline-[var(--brand-green)]"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-[var(--color-text-muted)]">
              min
            </span>
          </span>
        </label>
        <button
          type="submit"
          className="min-h-12 self-end rounded-md bg-[var(--brand-green)] px-4 font-bold text-white"
        >
          Filtrar
        </button>
        <button
          type="button"
          onClick={clearFilters}
          className="min-h-12 self-end rounded-md border border-[var(--color-border-strong)] bg-white px-4 font-semibold"
        >
          Limpiar
        </button>
        {filterError !== null ? (
          <p
            id="delivery-filter-error"
            role="alert"
            className="lg:col-span-5 text-sm font-semibold text-[var(--status-critical)]"
          >
            {filterError}
          </p>
        ) : null}
      </form>

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
          <h2 className="text-xl font-bold">No hay órdenes listas</h2>
          <p className="mt-2 text-[var(--color-text-muted)]">
            Las órdenes preparadas aparecerán aquí automáticamente.
          </p>
        </section>
      ) : (
        <section
          aria-busy={refreshing}
          aria-label="Órdenes listas para entregar"
          className="mt-5 grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--kds-card-min)),1fr))]"
        >
          {orders.map((order) => (
            <DeliveryOrderCard
              key={order.id}
              order={order}
              now={now}
              thresholds={thresholdByRestaurant.get(order.restaurantId)!}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function DeliveryOrderCard({
  order,
  now,
  thresholds,
}: Readonly<{
  order: DeliveryQueueItem;
  now: number;
  thresholds: DeliveryThresholds;
}>) {
  const elapsed = elapsedMilliseconds(order.readyAt, now);
  const priority = deliveryPriority(order.readyAt, now, thresholds);
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
            {order.serviceLocation.type === "TABLE" ? "Mesa" : "Ubicación"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span
            className={`inline-block rounded-sm px-2 py-1 text-xs font-bold uppercase ${presentation.badgeClass}`}
          >
            {presentation.label}
          </span>
          <p
            aria-label={`Tiempo esperando entrega: ${formatWaitingTime(elapsed)}`}
            className="mt-2 text-xl font-bold tabular-nums"
          >
            {formatWaitingTime(elapsed)}
          </p>
        </div>
      </header>
      <div className="p-4">
        <p className="text-lg font-bold tabular-nums">
          {order.productCount}{" "}
          {order.productCount === 1 ? "producto" : "productos"}
        </p>
        {order.specialObservations.length > 0 ? (
          <div className="mt-3 border-l-2 border-[var(--status-info)] pl-3">
            <h3 className="text-sm font-bold">Observaciones especiales</h3>
            <ul className="mt-1 list-disc pl-5 text-sm font-semibold">
              {order.specialObservations.map((observation, index) => (
                <li key={`${order.id}-${index}`}>{observation}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            Sin observaciones especiales.
          </p>
        )}
      </div>
    </article>
  );
}
