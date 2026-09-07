"use client";

import { useMemo, useState } from "react";

import type {
  InventoryPurchaseExpenseCategory,
  InventoryPurchaseItem,
  InventoryPurchaseRestaurant,
} from "@/application";

import { registerInventoryPurchase } from "./actions";

type PurchaseRegistrationFormProps = Readonly<{
  restaurants: readonly InventoryPurchaseRestaurant[];
  items: readonly InventoryPurchaseItem[];
  expenseCategories: readonly InventoryPurchaseExpenseCategory[];
}>;

export function PurchaseRegistrationForm({
  restaurants,
  items,
  expenseCategories,
}: PurchaseRegistrationFormProps) {
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? "");
  const restaurantItems = useMemo(
    () => items.filter((item) => item.restaurantId === restaurantId),
    [items, restaurantId],
  );
  const restaurantCategories = useMemo(
    () =>
      expenseCategories.filter(
        (category) => category.restaurantId === restaurantId,
      ),
    [expenseCategories, restaurantId],
  );
  const [inventoryItemId, setInventoryItemId] = useState(
    restaurantItems[0]?.id ?? "",
  );
  const [expenseCategoryId, setExpenseCategoryId] = useState(
    restaurantCategories[0]?.id ?? "",
  );

  const selectedInventoryItemId = restaurantItems.some(
    (item) => item.id === inventoryItemId,
  )
    ? inventoryItemId
    : (restaurantItems[0]?.id ?? "");
  const selectedExpenseCategoryId = restaurantCategories.some(
    (category) => category.id === expenseCategoryId,
  )
    ? expenseCategoryId
    : (restaurantCategories[0]?.id ?? "");

  const selectedItem = restaurantItems.find(
    (item) => item.id === selectedInventoryItemId,
  );
  const unavailable =
    restaurantId === "" ||
    restaurantItems.length === 0 ||
    restaurantCategories.length === 0;

  return (
    <form action={registerInventoryPurchase} className="mt-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="text-sm font-semibold">
          Restaurante
          <select
            name="restaurantId"
            value={restaurantId}
            onChange={(event) => setRestaurantId(event.target.value)}
            required
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
          Categoría de gasto
          <select
            name="expenseCategoryId"
            value={selectedExpenseCategoryId}
            onChange={(event) => setExpenseCategoryId(event.target.value)}
            required
            disabled={restaurantCategories.length === 0}
            className={inputClass}
          >
            {restaurantCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({category.code})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Artículo
          <select
            name="inventoryItemId"
            value={selectedInventoryItemId}
            onChange={(event) => setInventoryItemId(event.target.value)}
            required
            disabled={restaurantItems.length === 0}
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
            aria-label="Unidad del artículo seleccionado"
            value={selectedItem?.unitOfMeasure ?? ""}
            readOnly
            className={`${inputClass} bg-[var(--color-surface-muted)]`}
          />
        </label>
        <label className="text-sm font-semibold">
          Cantidad recibida
          <input
            name="quantity"
            type="number"
            inputMode="decimal"
            min="0.001"
            max="99999999999.999"
            step="0.001"
            required
            placeholder="0.000"
            className={`${inputClass} tabular-nums`}
          />
        </label>
        <label className="text-sm font-semibold">
          Costo unitario (USD)
          <input
            name="unitPrice"
            type="number"
            inputMode="decimal"
            aria-label="Costo unitario en dólares estadounidenses (USD)"
            min="0.01"
            max="9999999999.99"
            step="0.01"
            required
            placeholder="USD 0.00"
            className={`${inputClass} tabular-nums`}
          />
        </label>
        <label className="text-sm font-semibold">
          Proveedor <span className="font-normal">(opcional)</span>
          <input name="supplierName" maxLength={200} className={inputClass} />
        </label>
        <label className="text-sm font-semibold">
          Comentarios <span className="font-normal">(opcional)</span>
          <textarea
            name="comments"
            rows={3}
            maxLength={2000}
            className={`${inputClass} py-3`}
          />
        </label>
      </div>
      {unavailable ? (
        <p role="alert" className="mt-4 text-sm text-[var(--status-critical)]">
          Selecciona un restaurante que tenga artículos y categorías de gasto
          activos antes de registrar una compra.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={unavailable}
        className="mt-5 min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--status-disabled)]"
      >
        Registrar compra
      </button>
    </form>
  );
}

const inputClass =
  "mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] px-3 font-normal focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:bg-[var(--color-surface-muted)]";
