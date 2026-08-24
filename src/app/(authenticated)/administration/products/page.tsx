import type {
  Product,
  ProductAdministrationCategory,
  ProductAdministrationRecipe,
  ProductAdministrationResaleItem,
  ProductAdministrationRestaurant,
  ProductAdministrationTaxRate,
  ProductModification,
} from "@/application";
import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createProductAdministrationService } from "@/lib/product-administration/server";

import { saveProduct } from "./actions";

type PageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;

type References = Readonly<{
  restaurants: readonly ProductAdministrationRestaurant[];
  categories: readonly ProductAdministrationCategory[];
  taxRates: readonly ProductAdministrationTaxRate[];
  recipes: readonly ProductAdministrationRecipe[];
  resaleItems: readonly ProductAdministrationResaleItem[];
}>;

const feedback: Readonly<Record<string, string>> = {
  created: "El producto y su primera versión fueron creados.",
  updated: "Se guardó una nueva versión del producto.",
  invalid_input:
    "Revisa el producto, sus precios y el formato de las modificaciones.",
  operation_failed:
    "No se pudo guardar el producto. Actualiza la página e inténtalo nuevamente.",
};

export default async function ProductsPage({ searchParams }: PageProps) {
  await requireServerPermission(
    "administration.products.manage",
    "/administration/products",
  );
  const result = await createProductAdministrationService().list();
  const rawStatus = (await searchParams).status;
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
  const isError = status === "invalid_input" || status === "operation_failed";

  return (
    <div>
      <header>
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Administración
        </p>
        <h1 className="mt-2 text-3xl font-bold">Catálogo de productos</h1>
        <p className="mt-2 max-w-4xl text-[var(--color-text-muted)]">
          Configura precios, impuestos, impresión y modificaciones. Cada
          guardado crea una versión histórica nueva; las ventas anteriores no
          cambian.
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
          No se pudo cargar el catálogo de productos.
        </p>
      ) : (
        <>
          <section className={panelClass} aria-labelledby="new-product-title">
            <h2 id="new-product-title" className="text-lg font-bold">
              Nuevo producto
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              La receta puede vincularse después de crear el producto. El
              vínculo de reventa está disponible desde la primera versión.
            </p>
            <ProductForm
              references={result.value}
              disabled={
                result.value.restaurants.length === 0 ||
                !result.value.categories.some((item) => item.isActive) ||
                !result.value.taxRates.some((item) => item.isActive)
              }
            />
          </section>

          <section className="mt-6" aria-labelledby="configured-products-title">
            <h2 id="configured-products-title" className="text-xl font-bold">
              Productos configurados
            </h2>
            {result.value.products.length === 0 ? (
              <p className={`${panelClass} text-[var(--color-text-muted)]`}>
                Todavía no hay productos configurados.
              </p>
            ) : (
              <div className="mt-4 grid gap-4">
                {result.value.products.map((product) => (
                  <details key={product.id} className={panelClass}>
                    <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center justify-between gap-3 focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2">
                      <span>
                        <span className="block font-bold">{product.name}</span>
                        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                          {product.restaurantName} · {product.categoryName} ·
                          Versión {product.versionNumber} · $
                          {product.unitPrice.toFixed(2)}
                        </span>
                      </span>
                      <span
                        className={`rounded-sm px-2 py-1 text-xs font-semibold ${product.isActive ? "bg-[var(--status-new-bg)] text-[var(--status-new)]" : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"}`}
                      >
                        {product.isActive ? "Activo" : "Inactivo"}
                      </span>
                    </summary>
                    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                      <ProductForm
                        product={product}
                        references={result.value}
                      />
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ProductForm({
  product,
  references,
  disabled = false,
}: Readonly<{
  product?: Product;
  references: References;
  disabled?: boolean;
}>) {
  const restaurantId = product?.restaurantId;
  const restaurants = product
    ? references.restaurants.filter((item) => item.id === restaurantId)
    : references.restaurants;
  const categories = references.categories.filter(
    (item) =>
      (!restaurantId || item.restaurantId === restaurantId) &&
      (product ? true : item.isActive),
  );
  const taxRates = references.taxRates.filter(
    (item) =>
      (!restaurantId || item.restaurantId === restaurantId) &&
      (product ? true : item.isActive),
  );
  const recipes = product
    ? references.recipes.filter(
        (item) =>
          item.restaurantId === product.restaurantId &&
          item.productId === product.id,
      )
    : [];
  const resaleItems = references.resaleItems.filter(
    (item) => !restaurantId || item.restaurantId === restaurantId,
  );

  return (
    <form action={saveProduct}>
      {product ? <input type="hidden" name="id" value={product.id} /> : null}
      <fieldset className="mt-4">
        <legend className="font-bold">Identidad y disponibilidad</legend>
        <div className={fieldGridClass}>
          <SelectField
            name="restaurantId"
            label="Restaurante"
            defaultValue={restaurantId}
            options={restaurants.map((item) => [item.id, item.name])}
            disabled={Boolean(product)}
          />
          {product ? (
            <input
              type="hidden"
              name="restaurantId"
              value={product.restaurantId}
            />
          ) : null}
          <SelectField
            name="categoryId"
            label="Categoría"
            defaultValue={product?.categoryId}
            options={categories.map((item) => [
              item.id,
              labelWithRestaurant(item, references.restaurants),
            ])}
          />
          <TextField
            name="name"
            label="Nombre del producto"
            defaultValue={product?.name}
            maxLength={120}
          />
          <TextField
            name="displayOrder"
            label="Orden en el menú"
            type="number"
            defaultValue={String(product?.displayOrder ?? 0)}
            min="0"
            max="100000"
            step="1"
          />
          <CheckboxField
            name="isActive"
            label="Producto activo"
            defaultChecked={product?.isActive ?? true}
          />
        </div>
      </fieldset>

      <fieldset className="mt-6 border-t border-[var(--color-border)] pt-5">
        <legend className="font-bold">Precio, impuesto e impresión</legend>
        <div className={fieldGridClass}>
          <TextField
            name="unitPrice"
            label="Precio unitario"
            type="number"
            defaultValue={product?.unitPrice.toFixed(2)}
            min="0"
            max="9999999999.99"
            step="0.01"
          />
          <SelectField
            name="taxRateId"
            label="Impuesto"
            defaultValue={product?.taxRateId}
            options={taxRates.map((item) => [
              item.id,
              `${labelWithRestaurant(item, references.restaurants)} · ${(item.rate * 100).toFixed(2)}%`,
            ])}
          />
          <TextField
            name="printerAlias"
            label="Alias de impresora"
            defaultValue={product?.printerAlias}
            maxLength={120}
          />
          <CheckboxField
            name="priceIncludesTax"
            label="El precio incluye impuesto"
            defaultChecked={product?.priceIncludesTax ?? true}
          />
        </div>
      </fieldset>

      <fieldset className="mt-6 border-t border-[var(--color-border)] pt-5">
        <legend className="font-bold">Fuente de inventario opcional</legend>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Selecciona una receta o un artículo de reventa, nunca ambos. Guardar
          no genera movimientos de inventario.
        </p>
        <div className={fieldGridClass}>
          <SelectField
            name="recipeId"
            label="Receta vinculada"
            defaultValue={product?.recipeId ?? ""}
            options={recipes.map((item) => [item.id, item.name])}
            optionalLabel="Sin receta"
          />
          <SelectField
            name="resaleInventoryItemId"
            label="Artículo de inventario para reventa"
            defaultValue={product?.resaleInventoryItemId ?? ""}
            options={resaleItems.map((item) => [
              item.id,
              `${labelWithRestaurant(item, references.restaurants)} · ${item.unitOfMeasure}`,
            ])}
            optionalLabel="Sin vínculo de reventa"
          />
        </div>
      </fieldset>

      <fieldset className="mt-6 border-t border-[var(--color-border)] pt-5">
        <legend className="font-bold">Modificaciones disponibles</legend>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Escribe una opción por línea como <code>Nombre | 0.50</code>. Omite el
          valor después de la barra cuando no cambia el precio.
        </p>
        <div className={fieldGridClass}>
          <ModificationField
            name="optionLines"
            label="Opciones"
            defaultValue={formatModifications(product?.options ?? [])}
            placeholder={"Extra queso | 0.50\nSalsa picante"}
          />
          <ModificationField
            name="removableIngredientLines"
            label="Ingredientes removibles"
            defaultValue={formatModifications(
              product?.removableIngredients ?? [],
            )}
            placeholder={"Sin cebolla\nSin cilantro"}
          />
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={disabled}
        className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:bg-[var(--status-disabled)]`}
      >
        {product ? "Guardar nueva versión" : "Crear producto"}
      </button>
      {disabled ? (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          Se necesita un restaurante con catálogo, una categoría activa y un
          impuesto activo.
        </p>
      ) : null}
    </form>
  );
}

function TextField({
  name,
  label,
  defaultValue,
  type = "text",
  ...constraints
}: Readonly<{
  name: string;
  label: string;
  defaultValue?: string;
  type?: "text" | "number";
  maxLength?: number;
  min?: string;
  max?: string;
  step?: string;
}>) {
  return (
    <label className="text-sm font-semibold">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required
        className={inputClass}
        {...constraints}
      />
    </label>
  );
}

function SelectField({
  name,
  label,
  defaultValue,
  options,
  optionalLabel,
  disabled = false,
}: Readonly<{
  name: string;
  label: string;
  defaultValue?: string;
  options: readonly (readonly [string, string])[];
  optionalLabel?: string;
  disabled?: boolean;
}>) {
  return (
    <label className="text-sm font-semibold">
      {label}
      <select
        name={name}
        defaultValue={defaultValue}
        required={!optionalLabel}
        disabled={disabled}
        className={`${inputClass} disabled:bg-[var(--color-surface-muted)]`}
      >
        {optionalLabel ? <option value="">{optionalLabel}</option> : null}
        {options.map(([id, optionLabel]) => (
          <option key={id} value={id}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxField({
  name,
  label,
  defaultChecked,
}: Readonly<{ name: string; label: string; defaultChecked: boolean }>) {
  return (
    <label className="flex min-h-12 items-center gap-3 rounded-md border border-[var(--color-border)] px-3 text-sm font-semibold">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        className="h-5 w-5 accent-[var(--brand-green)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
      />
      {label}
    </label>
  );
}

function ModificationField({
  name,
  label,
  defaultValue,
  placeholder,
}: Readonly<{
  name: string;
  label: string;
  defaultValue: string;
  placeholder: string;
}>) {
  return (
    <label className="text-sm font-semibold">
      {label}
      <textarea
        name={name}
        rows={4}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={`${inputClass} py-3`}
      />
    </label>
  );
}

function labelWithRestaurant(
  item: Readonly<{ restaurantId: string; name: string }>,
  restaurants: readonly ProductAdministrationRestaurant[],
) {
  const restaurant = restaurants.find(
    (candidate) => candidate.id === item.restaurantId,
  );
  return `${restaurant?.name ?? "Restaurante"} · ${item.name}`;
}

function formatModifications(items: readonly ProductModification[]) {
  return items
    .map((item) =>
      item.priceAdjustment === null
        ? item.name
        : `${item.name} | ${item.priceAdjustment.toFixed(2)}`,
    )
    .join("\n");
}

const panelClass =
  "mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]";
const fieldGridClass = "mt-4 grid gap-4 md:grid-cols-2";
const primaryButtonClass =
  "mt-6 min-h-12 rounded-md bg-[var(--brand-green)] px-5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";
const inputClass =
  "mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] bg-white px-3 font-normal focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";
