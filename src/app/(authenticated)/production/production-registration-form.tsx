"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { Recipe } from "@/application";

import {
  completeProductionBatch,
  type CompleteProductionBatchActionState,
} from "./actions";

type ProductionRegistrationFormProps = Readonly<{
  recipes: readonly Recipe[];
}>;

const inputClass =
  "mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] bg-white px-3 text-base font-normal focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:bg-[var(--color-surface-muted)]";

export function ProductionRegistrationForm({
  recipes,
}: ProductionRegistrationFormProps) {
  const router = useRouter();
  const [restaurantId, setRestaurantId] = useState(
    recipes[0]?.restaurantId ?? "",
  );
  const [recipeVersionId, setRecipeVersionId] = useState("");
  const [feedback, setFeedback] =
    useState<CompleteProductionBatchActionState | null>(null);
  const [isPending, startTransition] = useTransition();
  const submissionLock = useRef(false);
  const restaurantRecipes = useMemo(
    () => recipes.filter((recipe) => recipe.restaurantId === restaurantId),
    [recipes, restaurantId],
  );
  const selectedVersionId = restaurantRecipes.some(
    (recipe) => recipe.versionId === recipeVersionId,
  )
    ? recipeVersionId
    : (restaurantRecipes[0]?.versionId ?? "");
  const selectedRecipe = restaurantRecipes.find(
    (recipe) => recipe.versionId === selectedVersionId,
  );
  const unavailable = restaurantId === "" || restaurantRecipes.length === 0;
  const restaurants = useMemo(
    () =>
      [
        ...new Map(
          recipes.map((recipe) => [recipe.restaurantId, recipe.restaurantName]),
        ).entries(),
      ].map(([id, name]) => ({ id, name })),
    [recipes],
  );

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || submissionLock.current || unavailable) return;
    const form = event.currentTarget;
    submissionLock.current = true;
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await completeProductionBatch(new FormData(form));
        setFeedback(result);
        if (result.status === "success") {
          form.reset();
          setRecipeVersionId("");
          router.refresh();
        }
      } catch {
        setFeedback({
          status: "error",
          message: "No se pudo completar la producción. Inténtalo nuevamente.",
        });
      } finally {
        submissionLock.current = false;
      }
    });
  }

  return (
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
              setRecipeVersionId("");
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
          Receta y versión
          <select
            name="recipeVersionId"
            value={selectedVersionId}
            required
            disabled={isPending || unavailable}
            onChange={(event) => {
              setRecipeVersionId(event.target.value);
              setFeedback(null);
            }}
            className={inputClass}
          >
            {restaurantRecipes.map((recipe) => (
              <option key={recipe.versionId} value={recipe.versionId}>
                {recipe.name} · v{recipe.versionNumber}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Artículo producido
          <input
            value={selectedRecipe?.outputInventoryItemName ?? ""}
            readOnly
            aria-label="Artículo producido por la receta seleccionada"
            className={`${inputClass} bg-[var(--color-surface-muted)]`}
          />
        </label>
        <label className="text-sm font-semibold">
          Cantidad producida{" "}
          {selectedRecipe ? `(${selectedRecipe.producedUnit})` : ""}
          <input
            name="producedQuantity"
            type="number"
            inputMode="decimal"
            min="0.001"
            max="99999999999.999"
            step="0.001"
            required
            disabled={isPending || unavailable}
            onChange={() => setFeedback(null)}
            className={`${inputClass} tabular-nums`}
          />
        </label>
      </div>
      <label className="mt-4 block text-sm font-semibold">
        Notas (opcional)
        <textarea
          name="notes"
          rows={3}
          maxLength={2000}
          disabled={isPending || unavailable}
          onChange={() => setFeedback(null)}
          className={`${inputClass} py-3`}
        />
      </label>
      {unavailable ? (
        <p role="alert" className="mt-4 text-sm text-[var(--status-critical)]">
          No hay recetas activas disponibles para este restaurante.
        </p>
      ) : null}
      <ProductionFeedback feedback={feedback} />
      <button
        type="submit"
        disabled={isPending || unavailable}
        className="mt-5 min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--status-disabled)]"
      >
        {isPending ? "Completando producción…" : "Completar producción"}
      </button>
    </form>
  );
}

function ProductionFeedback({
  feedback,
}: Readonly<{ feedback: CompleteProductionBatchActionState | null }>) {
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
  return (
    <p
      role="status"
      className="mt-4 rounded-md border border-[var(--status-new)] bg-[var(--status-new-bg)] p-3 text-sm font-semibold text-[var(--status-new)]"
    >
      Producción completada. Se registraron {feedback.producedQuantity}{" "}
      {feedback.unitOfMeasure}.
    </p>
  );
}
