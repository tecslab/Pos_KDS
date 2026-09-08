"use client";

import { useMemo, useRef, useState, useTransition } from "react";

import type {
  InventoryPurchaseItem,
  InventoryPurchaseRestaurant,
} from "@/application";

import {
  registerInventoryAdjustment,
  registerInventoryWaste,
  type InventoryMovementActionState,
} from "./actions";

type Operation = "ADJUSTMENT" | "WASTE";

type AdjustmentWasteRegistrationFormsProps = Readonly<{
  restaurants: readonly InventoryPurchaseRestaurant[];
  items: readonly InventoryPurchaseItem[];
  canRegisterAdjustment: boolean;
  canRegisterWaste: boolean;
}>;

type RegistrationFormProps = Readonly<{
  operation: Operation;
  restaurants: readonly InventoryPurchaseRestaurant[];
  items: readonly InventoryPurchaseItem[];
}>;

const inputClass =
  "mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] bg-white px-3 text-base font-normal focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:bg-[var(--color-surface-muted)]";

export function AdjustmentWasteRegistrationForms({
  restaurants,
  items,
  canRegisterAdjustment,
  canRegisterWaste,
}: AdjustmentWasteRegistrationFormsProps) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {canRegisterAdjustment ? (
        <MovementRegistrationForm
          operation="ADJUSTMENT"
          restaurants={restaurants}
          items={items}
        />
      ) : null}
      {canRegisterWaste ? (
        <MovementRegistrationForm
          operation="WASTE"
          restaurants={restaurants}
          items={items}
        />
      ) : null}
    </div>
  );
}

function MovementRegistrationForm({
  operation,
  restaurants,
  items,
}: RegistrationFormProps) {
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? "");
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [feedback, setFeedback] = useState<InventoryMovementActionState | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const submissionLock = useRef(false);
  const restaurantItems = useMemo(
    () => items.filter((item) => item.restaurantId === restaurantId),
    [items, restaurantId],
  );
  const selectedInventoryItemId = restaurantItems.some(
    (item) => item.id === inventoryItemId,
  )
    ? inventoryItemId
    : (restaurantItems[0]?.id ?? "");
  const selectedItem = restaurantItems.find(
    (item) => item.id === selectedInventoryItemId,
  );
  const unavailable = restaurantId === "" || restaurantItems.length === 0;
  const action =
    operation === "ADJUSTMENT"
      ? registerInventoryAdjustment
      : registerInventoryWaste;
  const label = operation === "ADJUSTMENT" ? "ajuste" : "desperdicio";
  const quantityLabel =
    operation === "ADJUSTMENT"
      ? "Diferencia de inventario"
      : "Cantidad perdida";
  const quantityHint =
    operation === "ADJUSTMENT"
      ? "Usa un valor positivo para agregar existencias o negativo para retirarlas; no registra un saldo absoluto."
      : "Ingresa una cantidad positiva. El desperdicio siempre reduce las existencias.";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || submissionLock.current || unavailable) return;
    const form = event.currentTarget;
    submissionLock.current = true;
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await action(new FormData(form));
        setFeedback(result);
        if (result.status === "success") form.reset();
      } catch {
        setFeedback({
          status: "error",
          message:
            "No se pudo registrar el movimiento de inventario. Inténtalo nuevamente.",
        });
      } finally {
        submissionLock.current = false;
      }
    });
  }

  return (
    <section
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]"
      aria-labelledby={`${label}-form-title`}
    >
      <h2 id={`${label}-form-title`} className="text-xl font-bold">
        {operation === "ADJUSTMENT"
          ? "Registrar ajuste de inventario"
          : "Registrar desperdicio"}
      </h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        {quantityHint}
      </p>
      <form className="mt-5" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            Restaurante
            <select
              name="restaurantId"
              value={restaurantId}
              required
              disabled={isPending}
              onChange={(event) => {
                setRestaurantId(event.target.value);
                setFeedback(null);
              }}
              className={inputClass}
            >
              {restaurants.map((restaurant) => (
                <option key={restaurant.id} value={restaurant.id}>
                  {restaurant.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Artículo
            <select
              name="inventoryItemId"
              value={selectedInventoryItemId}
              required
              disabled={isPending || restaurantItems.length === 0}
              onChange={(event) => {
                setInventoryItemId(event.target.value);
                setFeedback(null);
              }}
              className={inputClass}
            >
              {restaurantItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Unidad
            <input
              aria-label={`Unidad del artículo seleccionado para ${label}`}
              value={selectedItem?.unitOfMeasure ?? ""}
              readOnly
              className={`${inputClass} bg-[var(--color-surface-muted)]`}
            />
          </label>
          <label className="text-sm font-semibold">
            {quantityLabel}{" "}
            {selectedItem ? `(${selectedItem.unitOfMeasure})` : ""}
            <input
              name="quantity"
              type="number"
              inputMode="decimal"
              min={operation === "ADJUSTMENT" ? "-99999999999.999" : "0.001"}
              max="99999999999.999"
              step="0.001"
              required
              disabled={isPending || unavailable}
              placeholder={operation === "ADJUSTMENT" ? "-0.000" : "0.000"}
              onChange={() => setFeedback(null)}
              className={`${inputClass} tabular-nums`}
            />
          </label>
        </div>
        <label className="mt-4 block text-sm font-semibold">
          Motivo
          <textarea
            name="reason"
            rows={3}
            maxLength={2000}
            required
            disabled={isPending || unavailable}
            onChange={() => setFeedback(null)}
            className={`${inputClass} py-3`}
          />
        </label>
        {unavailable ? (
          <p
            role="alert"
            className="mt-4 text-sm text-[var(--status-critical)]"
          >
            Selecciona un restaurante que tenga artículos activos antes de
            registrar un {label}.
          </p>
        ) : null}
        <MovementFeedback feedback={feedback} operation={operation} />
        <button
          type="submit"
          disabled={isPending || unavailable}
          className="mt-5 min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--status-disabled)]"
        >
          {isPending
            ? `Registrando ${label}…`
            : operation === "ADJUSTMENT"
              ? "Registrar ajuste"
              : "Registrar desperdicio"}
        </button>
      </form>
    </section>
  );
}

function MovementFeedback({
  feedback,
  operation,
}: Readonly<{
  feedback: InventoryMovementActionState | null;
  operation: Operation;
}>) {
  if (feedback === null) return null;
  if (feedback.status === "error") {
    return (
      <p
        role="alert"
        className="mt-4 rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-3 text-sm font-semibold text-[var(--status-critical)]"
      >
        {feedback.message}
      </p>
    );
  }

  const operationLabel =
    operation === "ADJUSTMENT" ? "Ajuste registrado" : "Desperdicio registrado";
  return (
    <p
      role="status"
      className="mt-4 rounded-md border border-[var(--status-new)] bg-[var(--status-new-bg)] p-3 text-sm font-semibold text-[var(--status-new)]"
    >
      {operationLabel}. Nuevo saldo: {feedback.newBalance}{" "}
      {feedback.unitOfMeasure}.
    </p>
  );
}
