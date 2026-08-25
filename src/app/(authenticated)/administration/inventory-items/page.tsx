import type {
  InventoryItem,
  InventoryItemAdministrationRestaurant,
  InventoryItemType,
} from "@/application";
import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createInventoryItemAdministrationService } from "@/lib/inventory-item-administration/server";

import { saveInventoryItem } from "./actions";

type PageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;

const feedback: Readonly<Record<string, string>> = {
  created: "El artículo de inventario fue creado.",
  updated: "El artículo de inventario fue actualizado.",
  invalid_input: "Revisa el nombre, la unidad y el stock mínimo.",
  operation_failed:
    "No se pudo guardar el artículo. Actualiza la página e inténtalo nuevamente.",
};

const typeLabels: Readonly<Record<InventoryItemType, string>> = {
  RAW_INGREDIENT: "Ingrediente crudo",
  PRODUCED_ITEM: "Artículo producido",
  RESALE_ITEM: "Artículo de reventa",
};

export default async function InventoryItemsPage({ searchParams }: PageProps) {
  await requireServerPermission(
    "administration.inventory.manage",
    "/administration/inventory-items",
  );
  const result = await createInventoryItemAdministrationService().list();
  const rawStatus = (await searchParams).status;
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
  const isError = status === "invalid_input" || status === "operation_failed";

  return (
    <div>
      <header>
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Administración
        </p>
        <h1 className="mt-2 text-3xl font-bold">Artículos de inventario</h1>
        <p className="mt-2 max-w-4xl text-[var(--color-text-muted)]">
          Configura ingredientes crudos, artículos producidos y de reventa. El
          stock mostrado se calcula desde movimientos históricos; guardar esta
          ficha no agrega, ajusta ni establece existencias.
        </p>
      </header>

      {status && feedback[status] ? (
        <p
          role={isError ? "alert" : "status"}
          className={`mt-5 rounded-md border p-4 text-sm font-semibold ${isError ? "border-[var(--status-critical)] bg-[var(--status-critical-bg)] text-[var(--status-critical)]" : "border-[var(--color-border)] bg-[var(--status-new-bg)]"}`}
        >
          {feedback[status]}
        </p>
      ) : null}

      {!result.ok ? (
        <p role="alert" className="mt-6 text-[var(--status-critical)]">
          No se pudieron cargar los artículos de inventario.
        </p>
      ) : (
        <>
          <section className={panelClass} aria-labelledby="new-item-title">
            <h2 id="new-item-title" className="text-lg font-bold">
              Nuevo artículo
            </h2>
            <InventoryItemForm
              restaurants={result.value.restaurants}
              disabled={result.value.restaurants.length === 0}
            />
          </section>

          <section className="mt-6" aria-labelledby="configured-items-title">
            <h2 id="configured-items-title" className="text-xl font-bold">
              Artículos configurados
            </h2>
            {result.value.items.length === 0 ? (
              <p className={`${panelClass} text-[var(--color-text-muted)]`}>
                Todavía no hay artículos de inventario configurados.
              </p>
            ) : (
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {result.value.items.map((item) => (
                  <form
                    key={item.id}
                    action={saveInventoryItem}
                    className={panelClass}
                  >
                    <input type="hidden" name="id" value={item.id} />
                    <input
                      type="hidden"
                      name="restaurantId"
                      value={item.restaurantId}
                    />
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-bold">{item.name}</p>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          {item.restaurantName} · {typeLabels[item.type]}
                        </p>
                        <p className="mt-2 font-semibold tabular-nums">
                          Existencia actual: {formatQuantity(item.currentStock)}{" "}
                          {item.unitOfMeasure}
                        </p>
                      </div>
                      <span
                        className={`rounded-sm px-2 py-1 text-xs font-semibold ${item.isActive ? "bg-[var(--status-new-bg)] text-[var(--status-new)]" : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"}`}
                      >
                        {item.isActive ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                    <InventoryItemFields item={item} />
                    <button type="submit" className={primaryButtonClass}>
                      Guardar cambios
                    </button>
                  </form>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function InventoryItemForm({
  restaurants,
  disabled,
}: Readonly<{
  restaurants: readonly InventoryItemAdministrationRestaurant[];
  disabled: boolean;
}>) {
  return (
    <form action={saveInventoryItem}>
      <label className="mt-4 block text-sm font-semibold">
        Restaurante
        <select name="restaurantId" required className={inputClass}>
          {restaurants.map((restaurant) => (
            <option key={restaurant.id} value={restaurant.id}>
              {restaurant.name}
            </option>
          ))}
        </select>
      </label>
      <InventoryItemFields />
      <button
        type="submit"
        disabled={disabled}
        className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:bg-[var(--status-disabled)]`}
      >
        Crear artículo
      </button>
      {disabled ? (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          No hay restaurantes activos disponibles.
        </p>
      ) : null}
    </form>
  );
}

function InventoryItemFields({ item }: Readonly<{ item?: InventoryItem }>) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-semibold">
        Nombre
        <input
          name="name"
          defaultValue={item?.name}
          required
          maxLength={120}
          className={inputClass}
        />
      </label>
      <label className="text-sm font-semibold">
        Tipo
        <select
          name="type"
          defaultValue={item?.type ?? "RAW_INGREDIENT"}
          disabled={item?.identityLocked}
          required
          className={inputClass}
        >
          {Object.entries(typeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {item?.identityLocked ? (
          <input type="hidden" name="type" value={item.type} />
        ) : null}
      </label>
      <label className="text-sm font-semibold">
        Unidad de medida
        <input
          name="unitOfMeasure"
          defaultValue={item?.unitOfMeasure}
          disabled={item?.identityLocked}
          required
          maxLength={40}
          placeholder="kg, g, unidad, litro"
          className={inputClass}
        />
        {item?.identityLocked ? (
          <input
            type="hidden"
            name="unitOfMeasure"
            value={item.unitOfMeasure}
          />
        ) : null}
      </label>
      <label className="text-sm font-semibold">
        Stock mínimo
        <input
          name="minimumStockLevel"
          type="number"
          defaultValue={formatQuantity(item?.minimumStockLevel ?? 0)}
          min="0"
          max="99999999999.999"
          step="0.001"
          required
          className={`${inputClass} tabular-nums`}
        />
      </label>
      <label className="flex min-h-12 items-center gap-3 rounded-md border border-[var(--color-border)] px-3 sm:col-span-2">
        <input
          type="checkbox"
          name="isActive"
          value="true"
          defaultChecked={item?.isActive ?? true}
          className="h-5 w-5 accent-[var(--brand-green)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
        />
        Artículo activo
      </label>
      {item?.identityLocked ? (
        <p className="text-sm text-[var(--color-text-muted)] sm:col-span-2">
          El tipo y la unidad están protegidos porque el artículo ya tiene
          movimientos. Su nombre, stock mínimo y estado sí pueden actualizarse.
        </p>
      ) : null}
    </div>
  );
}

function formatQuantity(value: number) {
  return value.toFixed(3).replace(/\.0+$|(?<=\.\d*)0+$/g, "");
}

const panelClass =
  "mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]";
const primaryButtonClass =
  "mt-4 min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";
const inputClass =
  "mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] px-3 font-normal focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:bg-[var(--color-surface-muted)]";
