"use client";

import { useEffect, useRef, useState } from "react";

import {
  ActiveOrderCancellationWorkflow,
  cancellationActionState,
  type CancellationState,
  type CancellationSummary,
} from "./active-order-cancellation";

type CancellableOrder = Readonly<{
  id: string;
  orderNumber: string;
}>;

type FocusTarget = Readonly<{ focus(): void }>;

export function moveCancellationFocus(
  open: boolean,
  confirmationTarget: FocusTarget | null,
  triggerTarget: FocusTarget | null,
) {
  (open ? confirmationTarget : triggerTarget)?.focus();
}

export function OrderCancellationPanel({
  order,
  disabled,
  onInteractionLockChange,
  onAuthorizationBlocked,
  onCancelled,
  onReload,
}: Readonly<{
  order: CancellableOrder;
  disabled: boolean;
  onInteractionLockChange(locked: boolean): void;
  onAuthorizationBlocked(): void;
  onCancelled(summary: CancellationSummary): void;
  onReload(): void;
}>) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<CancellationState>({ status: "idle" });
  const workflow = useRef<ActiveOrderCancellationWorkflow | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const reasonInput = useRef<HTMLTextAreaElement | null>(null);
  const hasOpened = useRef(false);
  const action = cancellationActionState(state, reason, confirmed, disabled);
  const busy = state.status === "pending" || state.status === "reconciling";
  const canClose =
    state.status === "idle" ||
    (state.status === "error" && state.recovery === "retry");
  const panelId = `cancel-order-${order.id}`;
  const titleId = `${panelId}-title`;
  const reasonId = `${panelId}-reason`;
  const feedbackId = `${panelId}-feedback`;

  useEffect(() => {
    if (open) {
      hasOpened.current = true;
      moveCancellationFocus(true, reasonInput.current, trigger.current);
      return;
    }
    if (hasOpened.current) {
      moveCancellationFocus(false, reasonInput.current, trigger.current);
      hasOpened.current = false;
    }
  }, [open]);

  function openConfirmation() {
    if (disabled) return;
    setOpen(true);
    onInteractionLockChange(true);
  }

  function closeConfirmation() {
    if (!canClose) return;
    workflow.current = null;
    setOpen(false);
    setReason("");
    setConfirmed(false);
    setState({ status: "idle" });
    onInteractionLockChange(false);
  }

  function submitCancellation() {
    if (workflow.current === null) {
      workflow.current = new ActiveOrderCancellationWorkflow(
        async (input) =>
          fetch(`/api/v1/pos/orders/${input.orderId}`, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reason: input.reason }),
          }),
        async (orderId) => fetch(`/api/v1/pos/orders/${orderId}`),
        setState,
        async (summary) => {
          onInteractionLockChange(false);
          onCancelled(summary);
        },
        () => {
          onInteractionLockChange(false);
          onAuthorizationBlocked();
        },
      );
    }
    void workflow.current.submit({ orderId: order.id, reason }, confirmed);
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        hidden={open}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={openConfirmation}
        className="mt-5 min-h-12 w-full rounded-md border border-[var(--brand-red)] px-4 font-bold text-[var(--brand-red)] hover:bg-[var(--status-critical-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Cancelar orden
      </button>
      {open ? (
        <section
          id={panelId}
          role="dialog"
          className="mt-5 rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-4"
          aria-labelledby={titleId}
        >
          <h3 id={titleId} className="text-lg font-bold">
            Cancelar orden {order.orderNumber}
          </h3>
          <p className="mt-2 text-sm text-[var(--color-text)]">
            Esta acción es final. La orden conservará su historial y el
            inventario se reconciliará al confirmar.
          </p>
          <label
            className="mt-4 block text-sm font-semibold"
            htmlFor={reasonId}
          >
            Motivo de cancelación
          </label>
          <textarea
            ref={reasonInput}
            id={reasonId}
            value={reason}
            rows={3}
            maxLength={2000}
            required
            disabled={busy}
            aria-describedby={feedbackId}
            onChange={(event) => {
              setReason(event.target.value);
              if (state.status === "error" && state.recovery === "retry") {
                setState({ status: "idle" });
              }
            }}
            className="mt-2 min-h-12 w-full rounded-md border border-[var(--status-critical)] bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--color-surface-muted)]"
          />
          <label className="mt-3 flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-[var(--color-border-strong)] bg-white px-3 py-2 font-semibold focus-within:ring-2 focus-within:ring-[var(--brand-green)] focus-within:ring-offset-2">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="h-5 w-5 shrink-0 accent-[var(--brand-red)]"
            />
            Confirmo que deseo cancelar esta orden de forma definitiva.
          </label>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={!canClose}
              onClick={closeConfirmation}
              className="min-h-12 rounded-md border border-[var(--color-border-strong)] bg-white px-4 font-semibold hover:bg-[var(--color-surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Volver
            </button>
            <button
              type="button"
              disabled={action.disabled}
              aria-describedby={feedbackId}
              onClick={submitCancellation}
              className="min-h-12 rounded-md bg-[var(--brand-red)] px-4 font-bold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {action.label}
            </button>
          </div>
          <CancellationFeedback id={feedbackId} state={state} />
          {state.status === "error" && state.recovery === "reconcile" ? (
            <button
              type="button"
              onClick={() => void workflow.current?.reconcile()}
              className="mt-3 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] bg-white px-4 font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
            >
              Verificar estado
            </button>
          ) : null}
          {state.status === "error" &&
          (state.recovery === "reload" || state.recovery === "blocked") ? (
            <button
              type="button"
              onClick={() => {
                onInteractionLockChange(false);
                onReload();
              }}
              className="mt-3 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] bg-white px-4 font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
            >
              Recargar orden
            </button>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function CancellationFeedback({
  id,
  state,
}: Readonly<{ id: string; state: CancellationState }>) {
  if (state.status === "idle") {
    return <p id={id} className="sr-only" />;
  }
  if (state.status === "pending" || state.status === "reconciling") {
    return (
      <p id={id} role="status" className="sr-only">
        {state.status === "pending"
          ? "Cancelación en curso."
          : "Verificación del estado en curso."}
      </p>
    );
  }
  if (state.status === "success") {
    return (
      <p id={id} role="status" className="sr-only">
        Cancelación confirmada.
      </p>
    );
  }
  return (
    <p
      id={id}
      role="alert"
      className="mt-3 rounded-md border border-[var(--status-critical)] bg-white p-3 text-sm font-semibold text-[var(--status-critical)]"
    >
      {state.message}
    </p>
  );
}
