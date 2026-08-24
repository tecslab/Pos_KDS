import type { ProductCategory } from "@/application";
import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createProductCategoryAdministrationService } from "@/lib/product-category-administration/server";

import { saveProductCategory } from "./actions";

type PageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;

const feedback: Readonly<Record<string, string>> = {
  created: "La categoría fue creada.",
  updated: "La categoría fue actualizada.",
  invalid_input: "Revisa el nombre y el orden de la categoría.",
  operation_failed: "No se pudo guardar la categoría. Inténtalo nuevamente.",
};

export default async function ProductCategoriesPage({
  searchParams,
}: PageProps) {
  await requireServerPermission(
    "administration.categories.manage",
    "/administration/categories",
  );
  const result = await createProductCategoryAdministrationService().list();
  const rawStatus = (await searchParams).status;
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
  const isError = status === "invalid_input" || status === "operation_failed";

  return (
    <div>
      <header>
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Administración
        </p>
        <h1 className="mt-2 text-3xl font-bold">Categorías de productos</h1>
        <p className="mt-2 text-[var(--color-text-muted)]">
          Organiza las secciones del menú del punto de venta. El orden menor se
          muestra primero y las categorías inactivas dejan de estar disponibles.
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
          No se pudieron cargar las categorías.
        </p>
      ) : (
        <>
          <section className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]">
            <h2 className="text-lg font-bold">Nueva categoría</h2>
            <CategoryForm
              restaurants={result.value.restaurants.map((restaurant) => [
                restaurant.id,
                restaurant.name,
              ])}
            />
          </section>

          <section className="mt-6" aria-labelledby="configured-categories">
            <h2 id="configured-categories" className="text-xl font-bold">
              Categorías configuradas
            </h2>
            {result.value.categories.length === 0 ? (
              <p className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-[var(--color-text-muted)]">
                Todavía no hay categorías configuradas.
              </p>
            ) : (
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {result.value.categories.map((category) => (
                  <form
                    key={category.id}
                    action={saveProductCategory}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]"
                  >
                    <input type="hidden" name="id" value={category.id} />
                    <input
                      type="hidden"
                      name="restaurantId"
                      value={category.restaurantId}
                    />
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-bold">{category.name}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {category.restaurantName}
                        </p>
                      </div>
                      <span
                        className={`rounded-sm px-2 py-1 text-xs font-semibold ${category.isActive ? "bg-[var(--status-new-bg)] text-[var(--status-new)]" : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"}`}
                      >
                        {category.isActive ? "Activa" : "Inactiva"}
                      </span>
                    </div>
                    <CategoryFields category={category} />
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

function CategoryForm({
  restaurants,
}: Readonly<{ restaurants: readonly (readonly [string, string])[] }>) {
  return (
    <form action={saveProductCategory}>
      <label className="mt-4 block text-sm font-semibold">
        Restaurante
        <select name="restaurantId" required className={inputClass}>
          {restaurants.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <CategoryFields />
      <button
        type="submit"
        disabled={restaurants.length === 0}
        className={`${primaryButtonClass} disabled:bg-[var(--status-disabled)]`}
      >
        Crear categoría
      </button>
      {restaurants.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          No hay restaurantes activos con catálogo disponible.
        </p>
      ) : null}
    </form>
  );
}

function CategoryFields({
  category,
}: Readonly<{ category?: ProductCategory }>) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-semibold">
        Nombre
        <input
          name="name"
          defaultValue={category?.name}
          required
          maxLength={120}
          className={inputClass}
        />
      </label>
      <label className="text-sm font-semibold">
        Orden en el menú
        <input
          name="displayOrder"
          type="number"
          min="0"
          max="100000"
          step="1"
          defaultValue={category?.displayOrder ?? 0}
          required
          className={inputClass}
        />
      </label>
      <label className="flex min-h-12 items-center gap-3 rounded-md border border-[var(--color-border)] px-3 sm:col-span-2">
        <input
          type="checkbox"
          name="isActive"
          value="true"
          defaultChecked={category?.isActive ?? true}
          className="h-5 w-5 accent-[var(--brand-green)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
        />
        Categoría activa
      </label>
    </div>
  );
}

const primaryButtonClass =
  "mt-4 min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";
const inputClass =
  "mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] px-3 font-normal focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";
