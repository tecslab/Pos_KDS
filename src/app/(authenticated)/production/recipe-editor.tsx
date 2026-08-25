"use client";

import { useMemo, useState } from "react";

import type {
  Recipe,
  RecipeAdministrationInventoryItem,
  RecipeAdministrationProduct,
  RecipeAdministrationRestaurant,
} from "@/application";

import { saveRecipe } from "./actions";

type IngredientDraft = Readonly<{
  key: string;
  inventoryItemId: string;
  requiredQuantity: string;
}>;

export function RecipeEditor({
  restaurants,
  products,
  inventoryItems,
  recipe,
}: Readonly<{
  restaurants: readonly RecipeAdministrationRestaurant[];
  products: readonly RecipeAdministrationProduct[];
  inventoryItems: readonly RecipeAdministrationInventoryItem[];
  recipe?: Recipe;
}>) {
  const [restaurantId, setRestaurantId] = useState(
    recipe?.restaurantId ?? restaurants[0]?.id ?? "",
  );
  const [productId, setProductId] = useState(recipe?.productId ?? "");
  const [outputId, setOutputId] = useState(recipe?.outputInventoryItemId ?? "");
  const [lines, setLines] = useState<IngredientDraft[]>(
    recipe?.ingredients.map((ingredient) => ({
      key: ingredient.id,
      inventoryItemId: ingredient.inventoryItemId,
      requiredQuantity: formatQuantity(ingredient.requiredQuantity),
    })) ?? [{ key: "new-0", inventoryItemId: "", requiredQuantity: "" }],
  );
  const eligibleProducts = useMemo(
    () =>
      products.filter(
        (value) => value.restaurantId === restaurantId && value.isActive,
      ),
    [products, restaurantId],
  );
  const outputs = useMemo(
    () =>
      inventoryItems.filter(
        (value) =>
          value.restaurantId === restaurantId &&
          value.type === "PRODUCED_ITEM" &&
          value.isActive,
      ),
    [inventoryItems, restaurantId],
  );
  const rawItems = useMemo(
    () =>
      inventoryItems.filter(
        (value) =>
          value.restaurantId === restaurantId &&
          value.type === "RAW_INGREDIENT" &&
          value.isActive,
      ),
    [inventoryItems, restaurantId],
  );
  const output = inventoryItems.find(
    (value) => value.id === outputId && value.restaurantId === restaurantId,
  );
  const locked = Boolean(recipe);

  function changeRestaurant(next: string) {
    setRestaurantId(next);
    setProductId("");
    setOutputId("");
    setLines([
      { key: `new-${Date.now()}`, inventoryItemId: "", requiredQuantity: "" },
    ]);
  }

  return (
    <form action={saveRecipe} className="mt-4">
      {recipe ? <input type="hidden" name="id" value={recipe.id} /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          Restaurante
          <select
            name="restaurantId"
            value={restaurantId}
            onChange={(event) => changeRestaurant(event.target.value)}
            disabled={locked}
            required
            className={inputClass}
          >
            <option value="">Selecciona un restaurante</option>
            {restaurants.map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
          </select>
          {locked ? (
            <input type="hidden" name="restaurantId" value={restaurantId} />
          ) : null}
        </label>
        <label className={labelClass}>
          Producto
          <select
            name="productId"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            disabled={locked}
            required
            className={inputClass}
          >
            <option value="">Selecciona un producto</option>
            {(locked
              ? products.filter((value) => value.id === recipe?.productId)
              : eligibleProducts
            ).map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
          </select>
          {locked ? (
            <input type="hidden" name="productId" value={productId} />
          ) : null}
        </label>
        <label className={labelClass}>
          Artículo producido
          <select
            name="outputInventoryItemId"
            value={outputId}
            onChange={(event) => setOutputId(event.target.value)}
            disabled={locked}
            required
            className={inputClass}
          >
            <option value="">Selecciona la salida</option>
            {(locked
              ? inventoryItems.filter(
                  (value) => value.id === recipe?.outputInventoryItemId,
                )
              : outputs
            ).map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
          </select>
          {locked ? (
            <input
              type="hidden"
              name="outputInventoryItemId"
              value={outputId}
            />
          ) : null}
        </label>
        <label className={labelClass}>
          Nombre de la receta
          <input
            name="name"
            defaultValue={recipe?.name}
            maxLength={120}
            required
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Cantidad producida
          <span className="flex items-center gap-2">
            <input
              name="producedQuantity"
              type="number"
              defaultValue={
                recipe ? formatQuantity(recipe.producedQuantity) : ""
              }
              min="0.001"
              max="99999999999.999"
              step="0.001"
              required
              className={`${inputClass} flex-1`}
            />
            <span
              className="pt-2 text-sm text-[var(--color-text-muted)]"
              aria-label="Unidad de salida"
            >
              {output?.unitOfMeasure ?? "unidad"}
            </span>
          </span>
        </label>
        <label className="flex min-h-12 items-center gap-3 rounded-md border border-[var(--color-border)] px-3 md:self-end">
          <input
            type="checkbox"
            name="isActive"
            value="true"
            defaultChecked={recipe?.isActive ?? true}
            className="h-5 w-5 accent-[var(--brand-green)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
          />
          Receta activa
        </label>
      </div>

      <fieldset className="mt-5 rounded-md border border-[var(--color-border)] p-4">
        <legend className="px-2 font-bold">Ingredientes crudos</legend>
        <div className="grid gap-3">
          {lines.map((line, index) => {
            const item = inventoryItems.find(
              (value) =>
                value.id === line.inventoryItemId &&
                value.restaurantId === restaurantId,
            );
            return (
              <div
                key={line.key}
                className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto] sm:items-end"
              >
                <label className={labelClass}>
                  Ingrediente {index + 1}
                  <select
                    name="ingredientInventoryItemId"
                    value={line.inventoryItemId}
                    onChange={(event) =>
                      setLines((values) =>
                        values.map((value) =>
                          value.key === line.key
                            ? { ...value, inventoryItemId: event.target.value }
                            : value,
                        ),
                      )
                    }
                    required
                    className={inputClass}
                  >
                    <option value="">Selecciona un ingrediente</option>
                    {rawItems.map((value) => (
                      <option key={value.id} value={value.id}>
                        {value.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Cantidad requerida
                  <span className="flex items-center gap-2">
                    <input
                      name="ingredientRequiredQuantity"
                      type="number"
                      value={line.requiredQuantity}
                      onChange={(event) =>
                        setLines((values) =>
                          values.map((value) =>
                            value.key === line.key
                              ? {
                                  ...value,
                                  requiredQuantity: event.target.value,
                                }
                              : value,
                          ),
                        )
                      }
                      min="0.001"
                      max="99999999999.999"
                      step="0.001"
                      required
                      className={`${inputClass} flex-1`}
                    />
                    <span className="pt-2 text-sm text-[var(--color-text-muted)]">
                      {item?.unitOfMeasure ?? "unidad"}
                    </span>
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setLines((values) =>
                      values.filter((value) => value.key !== line.key),
                    )
                  }
                  disabled={lines.length === 1}
                  className="min-h-12 rounded-md border border-[var(--color-border-strong)] px-3 font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Quitar
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() =>
            setLines((values) =>
              values.length >= 100
                ? values
                : [
                    ...values,
                    {
                      key: `new-${Date.now()}-${values.length}`,
                      inventoryItemId: "",
                      requiredQuantity: "",
                    },
                  ],
            )
          }
          disabled={lines.length >= 100 || rawItems.length === 0}
          className="mt-4 min-h-12 rounded-md border border-[var(--brand-green)] px-4 font-semibold text-[var(--brand-green)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] disabled:opacity-50"
        >
          Agregar ingrediente
        </button>
      </fieldset>

      {locked ? (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">
          El restaurante, producto y artículo producido quedan protegidos. Este
          guardado creará la versión {recipe!.versionNumber + 1} sin modificar
          las versiones anteriores.
        </p>
      ) : null}
      <p className="mt-3 text-sm font-semibold">
        Guardar una receta no ejecuta producción ni crea movimientos de
        inventario.
      </p>
      <button
        type="submit"
        disabled={
          !restaurantId ||
          rawItems.length === 0 ||
          outputs.length === 0 ||
          eligibleProducts.length === 0
        }
        className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:bg-[var(--status-disabled)]`}
      >
        {recipe ? "Guardar nueva versión" : "Crear receta"}
      </button>
    </form>
  );
}

function formatQuantity(value: number) {
  return value.toFixed(3).replace(/\.0+$|(?<=\.\d*)0+$/g, "");
}
const labelClass = "text-sm font-semibold";
const inputClass =
  "mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] px-3 font-normal focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:bg-[var(--color-surface-muted)]";
const primaryButtonClass =
  "mt-4 min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";
