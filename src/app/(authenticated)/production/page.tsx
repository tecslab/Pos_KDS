import { unauthorizedError } from "@/domain";
import { requireServerAuthorizationContext } from "@/lib/auth/server-authorization";
import { createProductionHistoryService } from "@/lib/production-history/server";
import { createRecipeAdministrationService } from "@/lib/recipe-administration/server";

import { ProductionRegistrationForm } from "./production-registration-form";
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
  const authorization = await requireServerAuthorizationContext("/production");
  const permissions = new Set(authorization.permissionCodes);
  const canCreateBatch = permissions.has("production.batch.create");
  const canEditRecipes = permissions.has("production.recipes.edit");
  const canViewHistory = permissions.has("production.history.view");
  if (!canCreateBatch && !canEditRecipes && !canViewHistory) {
    throw unauthorizedError();
  }

  const [recipeResult, historyResult, params] = await Promise.all([
    canCreateBatch || canEditRecipes
      ? createRecipeAdministrationService().list()
      : Promise.resolve(null),
    canViewHistory
      ? createProductionHistoryService().list()
      : Promise.resolve(null),
    searchParams,
  ]);
  const rawStatus = params.status;
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
  const isError = status === "invalid_input" || status === "operation_failed";

  return (
    <div>
      <header>
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Producción
        </p>
        <h1 className="mt-2 text-3xl font-bold">Producción y recetas</h1>
        <p className="mt-2 max-w-4xl text-[var(--color-text-muted)]">
          Registra lotes únicamente con ingredientes suficientes y consulta el
          historial inmutable de la producción terminada.
        </p>
      </header>

      {status && feedback[status] && canEditRecipes ? (
        <p
          role={isError ? "alert" : "status"}
          className={`mt-5 rounded-md border p-4 text-sm font-semibold ${isError ? "border-[var(--status-critical)] bg-[var(--status-critical-bg)] text-[var(--status-critical)]" : "border-[var(--color-border)] bg-[var(--status-new-bg)]"}`}
        >
          {feedback[status]}
        </p>
      ) : null}

      {canCreateBatch ? (
        <section className={panelClass} aria-labelledby="production-form-title">
          <h2 id="production-form-title" className="text-xl font-bold">
            Registrar producción
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            La validación de ingredientes y los movimientos de inventario se
            completan juntos en el servidor.
          </p>
          {recipeResult?.ok ? (
            <ProductionRegistrationForm
              recipes={recipeResult.value.recipes.filter(
                (recipe) => recipe.isActive,
              )}
            />
          ) : (
            <p role="alert" className="mt-4 text-[var(--status-critical)]">
              No se pudieron cargar las recetas disponibles para producción.
              Actualiza la página e inténtalo nuevamente.
            </p>
          )}
        </section>
      ) : null}

      {canViewHistory ? (
        <ProductionHistory historyResult={historyResult} />
      ) : null}

      {canEditRecipes ? (
        <RecipeAdministration recipeResult={recipeResult} />
      ) : null}
    </div>
  );
}

function ProductionHistory({
  historyResult,
}: Readonly<{
  historyResult: Awaited<
    ReturnType<ReturnType<typeof createProductionHistoryService>["list"]>
  > | null;
}>) {
  return (
    <section className={panelClass} aria-labelledby="production-history-title">
      <div>
        <h2 id="production-history-title" className="text-xl font-bold">
          Historial de producción
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Los lotes terminados conservan su versión de receta, responsable,
          fecha y notas. No se pueden editar desde aquí.
        </p>
      </div>
      {!historyResult?.ok ? (
        <p role="alert" className="mt-4 text-[var(--status-critical)]">
          No se pudo cargar el historial de producción. Actualiza la página e
          inténtalo nuevamente.
        </p>
      ) : historyResult.value.length === 0 ? (
        <p className="mt-4 text-[var(--color-text-muted)]">
          Todavía no hay lotes de producción terminados.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table
            className="min-w-full text-left text-sm"
            aria-label="Historial de producción"
          >
            <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Receta</th>
                <th className="px-4 py-3 font-semibold">Cantidad</th>
                <th className="px-4 py-3 font-semibold">Completó</th>
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Notas</th>
              </tr>
            </thead>
            <tbody>
              {historyResult.value.map((batch) => (
                <tr
                  key={batch.batchId}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="px-4 py-3 font-semibold">
                    {batch.recipeName}
                    <span className="block font-normal text-[var(--color-text-muted)]">
                      {batch.productName} · {batch.restaurantName} · Versión{" "}
                      {batch.recipeVersionNumber}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-bold tabular-nums">
                    {formatQuantity(batch.producedQuantity)}{" "}
                    {batch.unitOfMeasure}
                  </td>
                  <td className="px-4 py-3">{batch.completedBy.displayName}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatDateTime(batch.completedAt)}
                  </td>
                  <td className="px-4 py-3">{batch.notes ?? "Sin notas"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RecipeAdministration({
  recipeResult,
}: Readonly<{
  recipeResult: Awaited<
    ReturnType<ReturnType<typeof createRecipeAdministrationService>["list"]>
  > | null;
}>) {
  if (!recipeResult?.ok) {
    return (
      <p role="alert" className="mt-6 text-[var(--status-critical)]">
        No se pudieron cargar las recetas.
      </p>
    );
  }
  return (
    <>
      <section className={panelClass} aria-labelledby="new-recipe-title">
        <h2 id="new-recipe-title" className="text-xl font-bold">
          Nueva receta
        </h2>
        <RecipeEditor
          restaurants={recipeResult.value.restaurants}
          products={recipeResult.value.products}
          inventoryItems={recipeResult.value.inventoryItems}
        />
      </section>
      <section className="mt-7" aria-labelledby="configured-recipes-title">
        <h2 id="configured-recipes-title" className="text-xl font-bold">
          Recetas configuradas
        </h2>
        {recipeResult.value.recipes.length === 0 ? (
          <p className={`${panelClass} text-[var(--color-text-muted)]`}>
            Todavía no hay recetas configuradas.
          </p>
        ) : (
          <div className="grid gap-5">
            {recipeResult.value.recipes.map((recipe) => (
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
                  restaurants={recipeResult.value.restaurants}
                  products={recipeResult.value.products}
                  inventoryItems={recipeResult.value.inventoryItems}
                />
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function formatQuantity(value: string) {
  return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const panelClass =
  "mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]";
