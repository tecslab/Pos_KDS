"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PendingPaymentOrder } from "@/application";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../../../lib/observability/recorder";

import {
  amountExceedsBalance,
  canRegisterSelectedPayment,
  canonicalPaymentAmount,
  formatCurrency,
  paymentDetailSelection,
  paymentRegistrationErrorMessage,
  paymentRegistrationRequest,
  parsePaymentRegistrationResult,
  parsePendingPaymentOrder,
  parsePendingPaymentOrders,
  PaymentRealtimeController,
  type PaymentConnectionStatus,
  type PaymentMethodChoice,
} from "./payment-display";

export type ConfiguredPaymentMethod = PaymentMethodChoice;

type PaymentWorkspaceProps = Readonly<{
  initialOrders: readonly PendingPaymentOrder[];
  methods: readonly ConfiguredPaymentMethod[];
  canRegister: boolean;
  canAuthorizeOverage: boolean;
}>;

const connectionPresentation: Readonly<
  Record<PaymentConnectionStatus, string>
> = Object.freeze({
  connecting: "Conectando actualizaciones en vivo",
  live: "Recibiendo actualizaciones en vivo",
  degraded: "Conexión interrumpida · actualización periódica activa",
});

export function PaymentWorkspace({
  initialOrders,
  methods,
  canRegister,
  canAuthorizeOverage,
}: PaymentWorkspaceProps) {
  const [orders, setOrders] = useState(initialOrders);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(
    initialOrders[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<PendingPaymentOrder | null>(
    initialOrders[0] ?? null,
  );
  const [selectedBasketId, setSelectedBasketId] = useState<string | null>(
    initialOrders[0]?.baskets.find((basket) => basket.status === "PENDING")
      ?.id ?? null,
  );
  const [methodId, setMethodId] = useState(
    paymentDetailSelection(initialOrders[0] ?? null, methods).methodId,
  );
  const [amount, setAmount] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [comments, setComments] = useState("");
  const [overageReason, setOverageReason] = useState("");
  const [connection, setConnection] =
    useState<PaymentConnectionStatus>("connecting");
  const [refreshing, setRefreshing] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const requestAbort = useRef<AbortController | null>(null);
  const detailAbort = useRef<AbortController | null>(null);
  const realtime = useRef<PaymentRealtimeController | null>(null);
  const selectedOrderRef = useRef(selectedOrderId);

  const restaurantIds = useMemo(
    () => [
      ...new Set([
        ...initialOrders.map((order) => order.restaurantId),
        ...methods.map((method) => method.restaurantId),
      ]),
    ],
    [initialOrders, methods],
  );
  const selectedBasket = detail?.baskets.find(
    (basket) => basket.id === selectedBasketId,
  );
  const activeMethods = useMemo(
    () =>
      detail === null
        ? []
        : methods
            .filter((method) => method.restaurantId === detail.restaurantId)
            .sort(
              (left, right) =>
                left.displayOrder - right.displayOrder ||
                left.name.localeCompare(right.name),
            ),
    [detail, methods],
  );
  const registrationAllowed = canRegisterSelectedPayment(
    detail,
    selectedBasket,
    canRegister,
    loadingDetail,
    methodId !== "",
  );

  const loadDetail = useCallback(
    async (orderId: string) => {
      detailAbort.current?.abort();
      const controller = new AbortController();
      detailAbort.current = controller;
      setLoadingDetail(true);
      setAmount("");
      setReferenceNumber("");
      setComments("");
      setOverageReason("");
      setFormError(null);
      try {
        const response = await fetch(`/api/v1/payments/orders/${orderId}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Payment detail request failed.");
        const parsed = parsePendingPaymentOrder(await response.json());
        if (parsed === null || parsed.id !== orderId) {
          throw new Error("Payment detail response was invalid.");
        }
        if (controller.signal.aborted || selectedOrderRef.current !== orderId) {
          return;
        }
        const selection = paymentDetailSelection(parsed, methods);
        setDetail(parsed);
        setSelectedBasketId(selection.basketId);
        setMethodId(selection.methodId);
        setDetailError(null);
      } catch {
        if (controller.signal.aborted) return;
        setDetailError(
          "No se pudo cargar el detalle de la cuenta. Intenta nuevamente.",
        );
      } finally {
        if (detailAbort.current === controller) {
          detailAbort.current = null;
          setLoadingDetail(false);
        }
      }
    },
    [methods],
  );

  const refreshOrders = useCallback(async () => {
    const controller = new AbortController();
    requestAbort.current = controller;
    setRefreshing(true);
    try {
      const response = await fetch("/api/v1/payments/orders", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Payment list request failed.");
      const parsed = parsePendingPaymentOrders(await response.json());
      if (parsed === null)
        throw new Error("Payment list response was invalid.");
      setOrders(parsed);
      setListError(null);
      const current = selectedOrderRef.current;
      if (current !== null && parsed.some((order) => order.id === current)) {
        await loadDetail(current);
      } else {
        const nextOrder = parsed[0] ?? null;
        const selection = paymentDetailSelection(nextOrder, methods);
        selectedOrderRef.current = selection.orderId;
        setSelectedOrderId(selection.orderId);
        if (nextOrder !== null) {
          await loadDetail(nextOrder.id);
        } else {
          setDetail(null);
          setSelectedBasketId(null);
          setMethodId("");
          setAmount("");
          setReferenceNumber("");
          setComments("");
          setOverageReason("");
          setFormError(null);
          setDetailError(null);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setListError(
        "No se pudieron actualizar las cuentas. Se conserva la última información disponible.",
      );
      throw error;
    } finally {
      if (requestAbort.current === controller) {
        requestAbort.current = null;
        setRefreshing(false);
      }
    }
  }, [loadDetail, methods]);

  useEffect(() => {
    selectedOrderRef.current = selectedOrderId;
  }, [selectedOrderId]);

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
        const controller = new PaymentRealtimeController({
          subscriber: new SupabaseRealtimeSubscriber(
            createBrowserSupabaseClient(),
            operationalTelemetry,
            operationalTelemetryClock,
          ),
          restaurantIds,
          refreshPayments: refreshOrders,
          onStatus: setConnection,
        });
        realtime.current = controller;
        await controller.start();
      } catch {
        if (disposed) return;
        setConnection("degraded");
        void refreshOrders().catch(() => undefined);
        importFallback = window.setInterval(() => {
          void refreshOrders().catch(() => undefined);
        }, 5_000);
      }
    }
    void connect();
    return () => {
      disposed = true;
      requestAbort.current?.abort();
      detailAbort.current?.abort();
      if (importFallback !== undefined) window.clearInterval(importFallback);
      const controller = realtime.current;
      realtime.current = null;
      if (controller !== null) void controller.stop();
    };
  }, [refreshOrders, restaurantIds]);

  const chooseOrder = (orderId: string) => {
    setSuccess(null);
    setFormError(null);
    setDetailError(null);
    selectedOrderRef.current = orderId;
    setSelectedOrderId(orderId);
    void loadDetail(orderId);
  };

  const chooseBasket = (basketId: string) => {
    setSelectedBasketId(basketId);
    setMethodId(activeMethods[0]?.id ?? "");
    setAmount("");
    setFormError(null);
    setOverageReason("");
  };

  const manuallyRefresh = () => {
    const controller = realtime.current;
    void (
      controller === null ? refreshOrders() : controller.refreshNow()
    ).catch(() => undefined);
  };

  const useOutstandingBalance = () => {
    if (selectedBasket === undefined) return;
    setAmount(selectedBasket.outstandingBalance);
    setFormError(null);
  };

  const registerPayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSuccess(null);
    if (
      !canRegisterSelectedPayment(
        detail,
        selectedBasket,
        canRegister,
        loadingDetail,
        methodId !== "",
      )
    ) {
      setFormError(
        detail?.status !== "DELIVERED"
          ? "Solo se pueden registrar pagos para órdenes entregadas."
          : "Selecciona una cuenta pendiente y un método de pago.",
      );
      return;
    }
    if (selectedBasket === undefined) return;
    const normalizedAmount = canonicalPaymentAmount(amount);
    if (normalizedAmount === null) {
      setFormError("Ingresa un monto válido mayor que cero.");
      return;
    }
    const isOverage = amountExceedsBalance(
      normalizedAmount,
      selectedBasket.outstandingBalance,
    );
    if (isOverage && !canAuthorizeOverage) {
      setFormError(
        "El monto no puede superar el saldo pendiente de esta cuenta.",
      );
      return;
    }
    if (isOverage && overageReason.trim().length === 0) {
      setFormError(
        "Un pago superior al saldo requiere una justificación autorizada.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(
          paymentRegistrationRequest(
            selectedBasket.id,
            methodId,
            normalizedAmount,
            referenceNumber,
            comments,
            isOverage ? overageReason : "",
          ),
        ),
      });
      if (!response.ok) {
        setFormError(
          paymentRegistrationErrorMessage(
            await response.json().catch(() => null),
          ),
        );
        return;
      }
      const result = parsePaymentRegistrationResult(
        await response.json(),
        selectedBasket.id,
      );
      if (result === null)
        throw new Error("Payment registration response was invalid.");
      setSuccess(
        result.orderStatus === "PAID"
          ? "Pago registrado. La orden quedó pagada."
          : `Pago registrado. Saldo pendiente: ${formatCurrency(result.basketOutstandingBalance)}.`,
      );
      setAmount("");
      setReferenceNumber("");
      setComments("");
      setOverageReason("");
      await refreshOrders().catch(() => undefined);
    } catch {
      setFormError(paymentRegistrationErrorMessage(null));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-lg bg-[var(--color-text)] p-5 text-white shadow-[var(--shadow-sm)]">
        <div>
          <p className="text-sm font-semibold text-[var(--status-new-bg)]">
            Cuentas
          </p>
          <h1 className="mt-1 text-3xl font-bold">Pagos pendientes</h1>
          <p className="mt-2 text-sm text-white/80">
            Registra pagos por cliente sin mezclar los saldos de cada cuenta.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="text-right text-sm text-white/80"
          >
            {connectionPresentation[connection]}
          </p>
          <button
            type="button"
            onClick={manuallyRefresh}
            disabled={refreshing}
            className="min-h-12 rounded-md border border-white/60 bg-white px-4 font-semibold text-[var(--color-text)] disabled:cursor-wait disabled:opacity-70"
          >
            {refreshing ? "Actualizando…" : "Actualizar cuentas"}
          </button>
        </div>
      </header>

      {listError !== null ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-4 font-semibold text-[var(--status-critical)]"
        >
          {listError}
        </p>
      ) : null}
      {detailError !== null ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-4 font-semibold text-[var(--status-critical)]"
        >
          {detailError}
        </p>
      ) : null}
      {success !== null ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 rounded-md border border-[var(--status-new)] bg-[var(--status-new-bg)] p-4 font-semibold text-[var(--status-new)]"
        >
          {success}
        </p>
      ) : null}

      <div className="mt-5 grid items-start gap-5 2xl:grid-cols-[minmax(18rem,0.8fr)_minmax(26rem,1.2fr)]">
        <section
          aria-busy={refreshing}
          aria-label="Órdenes con pagos pendientes"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-sm)]"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-bold">Órdenes por cobrar</h2>
            <span className="font-bold tabular-nums">{orders.length}</span>
          </div>
          {orders.length === 0 ? (
            <p className="mt-4 text-[var(--color-text-muted)]">
              No hay órdenes con saldo pendiente.
            </p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {orders.map((order) => (
                <li key={order.id}>
                  <button
                    type="button"
                    onClick={() => chooseOrder(order.id)}
                    aria-pressed={order.id === selectedOrderId}
                    className={`min-h-12 w-full rounded-md border p-4 text-left focus:outline-2 focus:outline-offset-2 focus:outline-[var(--brand-green)] ${order.id === selectedOrderId ? "border-[var(--brand-green)] bg-[var(--status-new-bg)]" : "border-[var(--color-border)] bg-white hover:border-[var(--color-border-strong)]"}`}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span>
                        <strong className="block text-lg">
                          {order.orderNumber}
                        </strong>
                        <span className="block text-sm text-[var(--color-text-muted)]">
                          {order.serviceLocation.name} · {order.baskets.length}{" "}
                          {order.baskets.length === 1 ? "cuenta" : "cuentas"}
                        </span>
                      </span>
                      <span className="text-right">
                        <strong className="block tabular-nums">
                          {formatCurrency(order.outstandingBalance)}
                        </strong>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          pendiente
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-label="Detalle y registro de pago"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]"
        >
          {detail === null ? (
            <EmptyDetail />
          ) : (
            <>
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] pb-4">
                <div>
                  <h2 className="text-2xl font-bold">{detail.orderNumber}</h2>
                  <p className="mt-1 text-[var(--color-text-muted)]">
                    {detail.serviceLocation.name} · Mesero:{" "}
                    {detail.assignedWaiter.displayName}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Saldo de la orden
                  </p>
                  <p className="text-2xl font-bold tabular-nums">
                    {formatCurrency(detail.outstandingBalance)}
                  </p>
                </div>
              </header>
              {loadingDetail ? (
                <p
                  role="status"
                  className="mt-4 text-sm text-[var(--color-text-muted)]"
                >
                  Actualizando detalle…
                </p>
              ) : null}
              <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(13rem,0.75fr)_minmax(18rem,1.25fr)]">
                <section aria-label="Cuentas de clientes">
                  <h3 className="font-bold">Cuentas de clientes</h3>
                  <div className="mt-3 grid gap-2">
                    {detail.baskets.map((basket, index) => (
                      <button
                        key={basket.id}
                        type="button"
                        onClick={() => chooseBasket(basket.id)}
                        aria-pressed={basket.id === selectedBasketId}
                        className={`min-h-12 rounded-md border p-3 text-left ${basket.id === selectedBasketId ? "border-[var(--brand-green)] bg-[var(--status-new-bg)]" : "border-[var(--color-border)]"}`}
                      >
                        <span className="flex justify-between gap-2">
                          <span>
                            Cliente {index + 1}
                            <small className="block text-[var(--color-text-muted)]">
                              {basket.status === "PAID"
                                ? "Pagada"
                                : "Pendiente"}
                            </small>
                          </span>
                          <strong className="tabular-nums">
                            {formatCurrency(basket.outstandingBalance)}
                          </strong>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
                <div>
                  {selectedBasket === undefined ? (
                    <p className="text-[var(--color-text-muted)]">
                      Selecciona una cuenta pendiente para registrar un pago.
                    </p>
                  ) : (
                    <>
                      <BasketHistory basket={selectedBasket} />{" "}
                      <form
                        onSubmit={registerPayment}
                        className="mt-5 border-t border-[var(--color-border)] pt-5"
                        aria-label="Registrar pago parcial"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <h3 className="text-lg font-bold">Registrar pago</h3>
                          <span className="text-sm font-semibold">
                            Saldo:{" "}
                            {formatCurrency(selectedBasket.outstandingBalance)}
                          </span>
                        </div>
                        <fieldset
                          disabled={!registrationAllowed || submitting}
                          className="mt-4"
                        >
                          <legend className="text-sm font-semibold">
                            Método configurado
                          </legend>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {activeMethods.map((method) => (
                              <button
                                key={method.id}
                                type="button"
                                onClick={() => setMethodId(method.id)}
                                aria-pressed={method.id === methodId}
                                className={`min-h-12 rounded-md border px-3 text-left font-semibold ${method.id === methodId ? "border-[var(--brand-green)] bg-[var(--status-new-bg)]" : "border-[var(--color-border-strong)] bg-white"}`}
                              >
                                {method.name}
                              </button>
                            ))}
                          </div>
                          {activeMethods.length === 0 ? (
                            <p
                              role="alert"
                              className="mt-2 text-sm font-semibold text-[var(--status-critical)]"
                            >
                              No hay métodos de pago activos para este
                              restaurante.
                            </p>
                          ) : null}
                          <label className="mt-4 grid gap-1 text-sm font-semibold">
                            Monto recibido
                            <input
                              name="amount"
                              value={amount}
                              onChange={(event) =>
                                setAmount(event.target.value)
                              }
                              inputMode="decimal"
                              pattern="[0-9]*[.]?[0-9]{0,2}"
                              maxLength={13}
                              aria-describedby={
                                formError === null
                                  ? undefined
                                  : "payment-form-feedback"
                              }
                              className="min-h-12 rounded-md border border-[var(--color-border-strong)] bg-white px-3 text-base tabular-nums focus:outline-2 focus:outline-offset-2 focus:outline-[var(--brand-green)]"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={useOutstandingBalance}
                            className="mt-2 min-h-12 rounded-md border border-[var(--color-border-strong)] bg-white px-3 text-sm font-semibold"
                          >
                            Usar saldo pendiente (
                            {formatCurrency(selectedBasket.outstandingBalance)})
                          </button>
                          <label className="mt-4 grid gap-1 text-sm font-semibold">
                            Referencia (opcional)
                            <input
                              value={referenceNumber}
                              onChange={(event) =>
                                setReferenceNumber(event.target.value)
                              }
                              maxLength={200}
                              className="min-h-12 rounded-md border border-[var(--color-border-strong)] bg-white px-3 text-base focus:outline-2 focus:outline-offset-2 focus:outline-[var(--brand-green)]"
                            />
                          </label>
                          <label className="mt-4 grid gap-1 text-sm font-semibold">
                            Nota (opcional)
                            <textarea
                              value={comments}
                              onChange={(event) =>
                                setComments(event.target.value)
                              }
                              maxLength={2000}
                              rows={3}
                              className="rounded-md border border-[var(--color-border-strong)] bg-white p-3 text-base focus:outline-2 focus:outline-offset-2 focus:outline-[var(--brand-green)]"
                            />
                          </label>
                          {canAuthorizeOverage ? (
                            <label className="mt-4 grid gap-1 text-sm font-semibold">
                              Justificación de sobrepago
                              <textarea
                                name="overageReason"
                                value={overageReason}
                                onChange={(event) =>
                                  setOverageReason(event.target.value)
                                }
                                maxLength={1000}
                                rows={3}
                                aria-describedby={
                                  formError === null
                                    ? undefined
                                    : "payment-form-feedback"
                                }
                                className="rounded-md border border-[var(--color-border-strong)] bg-white p-3 text-base focus:outline-2 focus:outline-offset-2 focus:outline-[var(--brand-green)]"
                              />
                              <span className="text-xs font-normal text-[var(--color-text-muted)]">
                                Requerida solo si el monto supera el saldo
                                pendiente.
                              </span>
                            </label>
                          ) : null}
                        </fieldset>
                        {formError !== null ? (
                          <p
                            id="payment-form-feedback"
                            role="alert"
                            className="mt-3 text-sm font-semibold text-[var(--status-critical)]"
                          >
                            {formError}
                          </p>
                        ) : null}
                        {detail.status !== "DELIVERED" ? (
                          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                            Esta orden debe estar entregada antes de registrar
                            un pago.
                          </p>
                        ) : null}
                        <button
                          type="submit"
                          disabled={
                            !registrationAllowed ||
                            submitting ||
                            activeMethods.length === 0
                          }
                          className="mt-4 min-h-12 w-full rounded-md bg-[var(--brand-green)] px-5 font-bold text-white disabled:cursor-not-allowed disabled:bg-[var(--status-disabled)]"
                        >
                          {submitting ? "Registrando pago…" : "Registrar pago"}
                        </button>
                        {!canRegister ? (
                          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                            Puedes consultar los pagos, pero no registrarlos.
                          </p>
                        ) : null}
                      </form>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="py-10 text-center">
      <h2 className="text-xl font-bold">Selecciona una orden</h2>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Aquí verás sus cuentas, historial inmutable y saldo pendiente.
      </p>
    </div>
  );
}

function BasketHistory({
  basket,
}: Readonly<{ basket: PendingPaymentOrder["baskets"][number] }>) {
  return (
    <section aria-label="Historial inmutable de pagos">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-bold">Historial de pagos</h3>
        <span className="text-sm text-[var(--color-text-muted)]">
          Pagado: {formatCurrency(basket.paidAmount)}
        </span>
      </div>
      {basket.payments.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Esta cuenta aún no tiene pagos registrados.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
          {basket.payments.map((payment) => (
            <li key={payment.id} className="p-3">
              <div className="flex justify-between gap-3">
                <span>
                  <strong>{payment.paymentMethodName}</strong>
                  <span className="block text-sm text-[var(--color-text-muted)]">
                    {payment.recordedBy.displayName} ·{" "}
                    {new Intl.DateTimeFormat("es-EC", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(payment.recordedAt))}
                  </span>
                </span>
                <strong className="tabular-nums">
                  {formatCurrency(payment.amount)}
                </strong>
              </div>
              {payment.referenceNumber !== null ? (
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Referencia: {payment.referenceNumber}
                </p>
              ) : null}
              {payment.comments !== null ? (
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Nota: {payment.comments}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
