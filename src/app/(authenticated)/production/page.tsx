import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createRecipeAdministrationService } from "@/lib/recipe-administration/server";

import { RecipeEditor } from "./recipe-editor";

type PageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;

const feedback: Readonly<Record<string, string>> = {
  created: "La receta y su versión 1 fueron creadas.",
  version_created:
    "La nueva versión de la receta fue creada sin alterar el historial.",
  invalid_input:
    "Revisa la receta, sus cantidades y que cada ingrediente aparezca una sola vez.",
  operation_failed:
    "No se pudo guardar la receta. Actualiza la página e inténtalo nuevamente.",
};

export default async function ProductionPage({ searchParams }: PageProps) {
  await requireServerPermission("production.recipes.edit", "/production");
  const result = await createRecipeAdministrationService().list();
  const rawStatus = (await searchParams).status;
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
  const isError = status === "invalid_input" || status === "operation_failed";

  return (
    <div>
      <header>
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Producción
        </p>
        <h1 className="mt-2 text-3xl font-bold">Administración de recetas</h1>
        <p className="mt-2 max-w-4xl text-[var(--color-text-muted)]">
          Define la salida producida y sus ingredientes crudos. Cada guardado de
          una receta existente conserva el historial y crea una versión nueva.
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
          No se pudieron cargar las recetas.
        </p>
      ) : (
        <>
          <section className={panelClass} aria-labelledby="new-recipe-title">
            <h2 id="new-recipe-title" className="text-xl font-bold">
              Nueva receta
            </h2>
            <RecipeEditor
              restaurants={result.value.restaurants}
              products={result.value.products}
              inventoryItems={result.value.inventoryItems}
            />
          </section>
          <section className="mt-7" aria-labelledby="configured-recipes-title">
            <h2 id="configured-recipes-title" className="text-xl font-bold">
              Recetas configuradas
            </h2>
            {result.value.recipes.length === 0 ? (
              <p className={`${panelClass} text-[var(--color-text-muted)]`}>
                Todavía no hay recetas configuradas.
              </p>
            ) : (
              <div className="grid gap-5">
                {result.value.recipes.map((recipe) => (
                  <article key={recipe.id} className={panelClass}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold">{recipe.name}</h3>
                        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                          {recipe.restaurantName} · {recipe.productName} →{" "}
                          {recipe.outputInventoryItemName}
                        </p>
                        <p className="mt-2 text-sm font-semibold">
                          Versión actual: {recipe.versionNumber}. Historial
                          preservado:{" "}
                          {recipe.availableVersionNumbers
                            .map((value) => `v${value}`)
                            .join(", ")}
                          .
                        </p>
                      </div>
                      <span
                        className={`rounded-sm px-2 py-1 text-xs font-semibold ${recipe.isActive ? "bg-[var(--status-new-bg)] text-[var(--status-new)]" : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"}`}
                      >
                        {recipe.isActive ? "Activa" : "Inactiva"}
                      </span>
                    </div>
                    <RecipeEditor
                      recipe={recipe}
                      restaurants={result.value.restaurants}
                      products={result.value.products}
                      inventoryItems={result.value.inventoryItems}
                    />
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const panelClass =
  "mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]";
