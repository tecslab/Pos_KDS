"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import type {
  PosOrderingContext,
  PosOrderingContextProduct,
  PosOrderingContextRestaurant,
  PosOrderingContextServiceLocation,
} from "@/application";

import {
  basketSubtotal,
  createDraftLine,
  draftReducer,
  draftTotal,
  initialDraftState,
  lineTotal,
} from "./draft-state";
import {
  confirmationActionState,
  DraftConfirmationWorkflow,
  toConfirmationInput,
} from "./draft-confirmation";
import type { ConfirmationState } from "./draft-confirmation";

type ContextState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{ status: "ready"; context: PosOrderingContext }>;

const selectedButtonClass =
  "border-[var(--brand-green)] bg-[var(--status-new-bg)] font-bold";
const neutralButtonClass =
  "border-[var(--color-border-strong)] bg-white hover:bg-[var(--color-surface-muted)]";
const touchButtonClass =
  "min-h-12 rounded-md border px-3 py-2 text-left text-base font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";

export function OrderDraftComposer() {
  const [contextState, setContextState] = useState<ContextState>({
    status: "loading",
  });
  const [draft, dispatch] = useReducer(draftReducer, initialDraftState);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );
  const [selectedOptionIds, setSelectedOptionIds] = useState<readonly string[]>(
    [],
  );
  const [selectedRemovalIds, setSelectedRemovalIds] = useState<
    readonly string[]
  >([]);
  const [observation, setObservation] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [basketName, setBasketName] = useState("");
  const [confirmationState, setConfirmationState] = useState<ConfirmationState>(
    { status: "idle" },
  );
  const nextLineId = useRef(1);
  const nextBasketId = useRef(1);
  const confirmationWorkflow = useRef<DraftConfirmationWorkflow | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/v1/pos/ordering-context", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("ordering context request failed");
        const body: unknown = await response.json();
        if (!isOrderingContext(body))
          throw new Error("invalid ordering context");
        setContextState({ status: "ready", context: body });
      })
      .catch(() => {
        if (!controller.signal.aborted) setContextState({ status: "error" });
      });

    return () => controller.abort();
  }, []);

  const selectedLocation = useMemo(
    () => findLocation(contextState, draft.locationId),
    [contextState, draft.locationId],
  );
  const selectedRestaurant = useMemo(
    () => findRestaurant(contextState, draft.locationId),
    [contextState, draft.locationId],
  );
  const categories = selectedRestaurant?.categories ?? [];
  const selectedCategory =
    categories.find((category) => category.id === selectedCategoryId) ?? null;
  const selectedProduct =
    selectedCategory?.products.find(
      (product) => product.id === selectedProductId,
    ) ?? null;

  function selectLocation(location: PosOrderingContextServiceLocation) {
    const restaurant = findRestaurantForLocation(contextState, location.id);
    if (!restaurant) return;
    dispatch({
      type: "select-location",
      locationId: location.id,
      restaurantId: restaurant.id,
    });
    setSelectedCategoryId(restaurant?.categories[0]?.id ?? null);
    resetProductConfiguration();
  }

  function selectProduct(product: PosOrderingContextProduct) {
    setSelectedProductId(product.id);
    setSelectedOptionIds([]);
    setSelectedRemovalIds([]);
    setObservation("");
    setQuantity(1);
  }

  function resetProductConfiguration() {
    setSelectedProductId(null);
    setSelectedOptionIds([]);
    setSelectedRemovalIds([]);
    setObservation("");
    setQuantity(1);
  }

  function addBasket() {
    const name = basketName.trim();
    if (!name) return;
    dispatch({
      type: "add-basket",
      basket: { id: `basket-${nextBasketId.current++}`, name },
    });
    setBasketName("");
  }

  function addLine() {
    if (!selectedProduct || !draft.locationId) return;
    dispatch({
      type: "add-line",
      line: createDraftLine({
        id: `line-${nextLineId.current++}`,
        basketId: draft.selectedBasketId,
        product: selectedProduct,
        selectedOptionIds,
        selectedRemovalIds,
        observation,
        quantity,
      }),
    });
    resetProductConfiguration();
  }

  if (confirmationWorkflow.current === null) {
    confirmationWorkflow.current = new DraftConfirmationWorkflow(
      async (input) =>
        fetch("/api/v1/pos/orders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
      setConfirmationState,
      () => {
        dispatch({ type: "clear" });
        setSelectedCategoryId(null);
        setBasketName("");
        resetProductConfiguration();
      },
    );
  }

  const confirmationInput = toConfirmationInput(draft);
  const confirmationAction = confirmationActionState(
    confirmationState,
    confirmationInput,
  );

  return (
    <div>
      <header>
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Punto de venta
        </p>
        <h1 className="mt-2 text-3xl font-bold">Nueva orden</h1>
        <p className="mt-2 max-w-4xl text-[var(--color-text-muted)]">
          Compón la orden y revisa sus totales antes de confirmarla. Este
          borrador solo está disponible en esta pantalla.
        </p>
      </header>

      {contextState.status === "loading" ? (
        <StatusPanel>Cargando ubicaciones y menú activo…</StatusPanel>
      ) : contextState.status === "error" ? (
        <p
          role="alert"
          className="mt-5 rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-4 text-sm font-semibold text-[var(--status-critical)]"
        >
          No se pudo cargar el menú activo. Actualiza la página e inténtalo de
          nuevo.
        </p>
      ) : !hasOrderingChoices(contextState.context) ? (
        <StatusPanel>
          No hay ubicaciones o productos activos disponibles para crear una
          orden.
        </StatusPanel>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-2 2xl:grid-cols-[minmax(15rem,0.8fr)_minmax(24rem,1.4fr)_minmax(20rem,1fr)]">
          <aside className={panelClass} aria-label="Ubicación y cuentas">
            <h2 className="text-xl font-bold">Ubicación</h2>
            <div className="mt-4 grid gap-2">
              {contextState.context.restaurants.map((restaurant) => (
                <div key={restaurant.id}>
                  <p className="mb-2 text-sm font-semibold text-[var(--color-text-muted)]">
                    {restaurant.name}
                  </p>
                  <div className="grid gap-2">
                    {restaurant.serviceLocations.map((location) => (
                      <button
                        key={location.id}
                        type="button"
                        aria-pressed={draft.locationId === location.id}
                        onClick={() => selectLocation(location)}
                        className={`${touchButtonClass} ${draft.locationId === location.id ? selectedButtonClass : neutralButtonClass}`}
                      >
                        <span className="block">{location.name}</span>
                        <span className="block text-sm font-normal text-[var(--color-text-muted)]">
                          {location.type}
                          {location.allowsMultipleActiveOrders
                            ? " · Admite órdenes simultáneas"
                            : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <section
              className="mt-6 border-t border-[var(--color-border)] pt-5"
              aria-labelledby="baskets-title"
            >
              <h2 id="baskets-title" className="text-xl font-bold">
                Cuentas
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Asigna productos a una cuenta compartida o individual.
              </p>
              <div className="mt-3 grid gap-2">
                {draft.baskets.map((basket) => (
                  <button
                    key={basket.id}
                    type="button"
                    aria-pressed={draft.selectedBasketId === basket.id}
                    onClick={() =>
                      dispatch({ type: "select-basket", basketId: basket.id })
                    }
                    className={`${touchButtonClass} ${draft.selectedBasketId === basket.id ? selectedButtonClass : neutralButtonClass}`}
                  >
                    {basket.name}
                  </button>
                ))}
              </div>
              <label className="mt-4 block text-sm font-semibold">
                Nueva cuenta individual
                <input
                  value={basketName}
                  onChange={(event) => setBasketName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addBasket();
                    }
                  }}
                  maxLength={80}
                  placeholder="Nombre del cliente"
                  className={inputClass}
                />
              </label>
              <button
                type="button"
                onClick={addBasket}
                className={`mt-2 w-full ${touchButtonClass} ${neutralButtonClass}`}
              >
                Agregar cuenta
              </button>
            </section>
          </aside>

          <section className={panelClass} aria-labelledby="products-title">
            <h2 id="products-title" className="text-xl font-bold">
              Productos
            </h2>
            {!selectedLocation ? (
              <p role="status" className="mt-4 text-[var(--color-text-muted)]">
                Selecciona una ubicación para ver el menú disponible.
              </p>
            ) : (
              <>
                <div
                  className="mt-4 flex flex-wrap gap-2"
                  aria-label="Categorías de productos"
                >
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      aria-pressed={selectedCategory?.id === category.id}
                      onClick={() => {
                        setSelectedCategoryId(category.id);
                        resetProductConfiguration();
                      }}
                      className={`${touchButtonClass} ${selectedCategory?.id === category.id ? selectedButtonClass : neutralButtonClass}`}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
                {selectedCategory?.products.length ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {selectedCategory.products.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        aria-pressed={selectedProduct?.id === product.id}
                        onClick={() => selectProduct(product)}
                        className={`${touchButtonClass} min-h-20 ${selectedProduct?.id === product.id ? selectedButtonClass : neutralButtonClass}`}
                      >
                        <span className="block">{product.name}</span>
                        <span className="mt-1 block text-sm font-normal tabular-nums text-[var(--color-text-muted)]">
                          {formatAmount(product.unitPrice)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p
                    role="status"
                    className="mt-4 text-[var(--color-text-muted)]"
                  >
                    Esta categoría no tiene productos disponibles.
                  </p>
                )}
                {selectedProduct ? (
                  <ProductConfiguration
                    product={selectedProduct}
                    selectedOptionIds={selectedOptionIds}
                    selectedRemovalIds={selectedRemovalIds}
                    observation={observation}
                    quantity={quantity}
                    onToggleOption={(id) =>
                      setSelectedOptionIds((ids) => toggleId(ids, id))
                    }
                    onToggleRemoval={(id) =>
                      setSelectedRemovalIds((ids) => toggleId(ids, id))
                    }
                    onObservationChange={setObservation}
                    onQuantityChange={setQuantity}
                    onAdd={addLine}
                  />
                ) : null}
              </>
            )}
          </section>

          <aside
            className={`${panelClass} lg:col-span-2 2xl:col-span-1 2xl:sticky 2xl:top-24 2xl:self-start`}
            aria-labelledby="order-summary-title"
          >
            <h2 id="order-summary-title" className="text-xl font-bold">
              Resumen de la orden
            </h2>
            {!draft.locationId ? (
              <p className="mt-4 text-sm text-[var(--color-text-muted)]">
                Selecciona una ubicación para iniciar el borrador.
              </p>
            ) : draft.lines.length === 0 ? (
              <p
                role="status"
                className="mt-4 text-sm text-[var(--color-text-muted)]"
              >
                Aún no hay productos en esta orden.
              </p>
            ) : (
              <div className="mt-4 grid gap-5">
                {draft.baskets.map((basket) => {
                  const lines = draft.lines.filter(
                    (line) => line.basketId === basket.id,
                  );
                  if (lines.length === 0) return null;
                  return (
                    <section
                      key={basket.id}
                      aria-label={`Cuenta ${basket.name}`}
                    >
                      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-2">
                        <h3 className="font-bold">{basket.name}</h3>
                        <span className="tabular-nums font-semibold">
                          {formatAmount(basketSubtotal(draft.lines, basket.id))}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-3">
                        {lines.map((line) => (
                          <DraftLineSummary
                            key={line.id}
                            line={line}
                            onQuantityChange={(nextQuantity) =>
                              dispatch({
                                type: "set-line-quantity",
                                lineId: line.id,
                                quantity: nextQuantity,
                              })
                            }
                            onRemove={() =>
                              dispatch({ type: "remove-line", lineId: line.id })
                            }
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
            <div className="mt-6 flex items-end justify-between gap-3 border-t border-[var(--color-border)] pt-4">
              <span className="text-lg font-bold">Total</span>
              <output
                aria-label="Total de la orden"
                className="text-2xl font-bold tabular-nums"
              >
                {formatAmount(draftTotal(draft.lines))}
              </output>
            </div>
            <button
              type="button"
              onClick={() => dispatch({ type: "clear" })}
              disabled={
                confirmationState.status === "pending" ||
                (draft.lines.length === 0 && !draft.locationId)
              }
              className="mt-5 min-h-12 w-full rounded-md border border-[var(--brand-red)] px-3 font-semibold text-[var(--brand-red)] hover:bg-[var(--status-critical-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancelar borrador
            </button>
            <button
              type="button"
              onClick={() => {
                void confirmationWorkflow.current?.submit(confirmationInput);
              }}
              disabled={confirmationAction.disabled}
              aria-describedby="confirmation-feedback"
              className="mt-3 min-h-12 w-full rounded-md bg-[var(--brand-green)] px-4 font-bold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmationAction.label}
            </button>
            <ConfirmationFeedback state={confirmationState} />
          </aside>
        </div>
      )}
    </div>
  );
}

function ConfirmationFeedback({
  state,
}: Readonly<{ state: ConfirmationState }>) {
  if (state.status === "idle" || state.status === "pending") {
    return <p id="confirmation-feedback" className="sr-only" />;
  }

  if (state.status === "success") {
    return (
      <p
        id="confirmation-feedback"
        role="status"
        className="mt-3 rounded-md border border-[var(--status-new)] bg-[var(--status-new-bg)] p-3 text-sm font-semibold text-[var(--status-new)]"
      >
        {state.orderNumber === null
          ? "La orden se confirmó. Se solicitó el envío a cocina."
          : `La orden ${state.orderNumber} se confirmó. Se solicitó el envío a cocina.`}
      </p>
    );
  }

  return (
    <p
      id="confirmation-feedback"
      role="alert"
      className="mt-3 rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-3 text-sm font-semibold text-[var(--status-critical)]"
    >
      {state.message}
    </p>
  );
}

function ProductConfiguration({
  product,
  selectedOptionIds,
  selectedRemovalIds,
  observation,
  quantity,
  onToggleOption,
  onToggleRemoval,
  onObservationChange,
  onQuantityChange,
  onAdd,
}: Readonly<{
  product: PosOrderingContextProduct;
  selectedOptionIds: readonly string[];
  selectedRemovalIds: readonly string[];
  observation: string;
  quantity: number;
  onToggleOption(id: string): void;
  onToggleRemoval(id: string): void;
  onObservationChange(value: string): void;
  onQuantityChange(value: number): void;
  onAdd(): void;
}>) {
  return (
    <section
      className="mt-6 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] p-4"
      aria-labelledby="product-configuration-title"
    >
      <h2 id="product-configuration-title" className="text-lg font-bold">
        Configurar {product.name}
      </h2>
      {product.options.length > 0 ? (
        <ModificationGroup
          title="Opciones"
          modifications={product.options}
          selectedIds={selectedOptionIds}
          onToggle={onToggleOption}
        />
      ) : null}
      {product.removableIngredients.length > 0 ? (
        <ModificationGroup
          title="Ingredientes a retirar"
          modifications={product.removableIngredients}
          selectedIds={selectedRemovalIds}
          onToggle={onToggleRemoval}
        />
      ) : null}
      {product.options.length === 0 &&
      product.removableIngredients.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          Este producto no tiene modificaciones disponibles.
        </p>
      ) : null}
      <label className="mt-4 block text-sm font-semibold">
        Observaciones opcionales
        <textarea
          value={observation}
          onChange={(event) => onObservationChange(event.target.value)}
          maxLength={500}
          rows={2}
          className={inputClass}
        />
      </label>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <p id="quantity-label" className="mb-2 text-sm font-semibold">
            Cantidad
          </p>
          <div className="grid min-h-12 grid-cols-3 rounded-md border border-[var(--color-border-strong)] bg-white text-center">
            <button
              type="button"
              aria-label="Disminuir cantidad"
              onClick={() => onQuantityChange(Math.max(1, quantity - 1))}
              className="min-h-12 border-r border-[var(--color-border)] text-xl font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-inset"
            >
              −
            </button>
            <output
              aria-labelledby="quantity-label"
              className="self-center px-4 font-bold tabular-nums"
            >
              {quantity}
            </output>
            <button
              type="button"
              aria-label="Aumentar cantidad"
              onClick={() => onQuantityChange(quantity + 1)}
              className="min-h-12 border-l border-[var(--color-border)] text-xl font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-inset"
            >
              +
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="min-h-12 flex-1 rounded-md bg-[var(--brand-green)] px-4 font-bold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
        >
          Agregar a la cuenta
        </button>
      </div>
    </section>
  );
}

function ModificationGroup({
  title,
  modifications,
  selectedIds,
  onToggle,
}: Readonly<{
  title: string;
  modifications: readonly {
    id: string;
    name: string;
    priceAdjustment: number | null;
  }[];
  selectedIds: readonly string[];
  onToggle(id: string): void;
}>) {
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-semibold">{title}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {modifications.map((modification) => {
          const selected = selectedIds.includes(modification.id);
          return (
            <button
              key={modification.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onToggle(modification.id)}
              className={`${touchButtonClass} ${selected ? selectedButtonClass : neutralButtonClass}`}
            >
              {modification.name}
              {modification.priceAdjustment !== null ? (
                <span className="ml-1 text-sm font-normal tabular-nums">
                  ({modification.priceAdjustment >= 0 ? "+" : ""}
                  {formatAmount(modification.priceAdjustment)})
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function DraftLineSummary({
  line,
  onQuantityChange,
  onRemove,
}: Readonly<{
  line: ReturnType<typeof createDraftLine>;
  onQuantityChange(quantity: number): void;
  onRemove(): void;
}>) {
  const modifications = [...line.options, ...line.removableIngredients];
  return (
    <article className="rounded-md border border-[var(--color-border)] bg-white p-3">
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{line.productName}</p>
          {modifications.length > 0 ? (
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {modifications
                .map((modification) => modification.name)
                .join(", ")}
            </p>
          ) : null}
          {line.observation ? (
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {line.observation}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 font-semibold tabular-nums">
          {formatAmount(lineTotal(line))}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="grid min-h-12 grid-cols-3 rounded-md border border-[var(--color-border-strong)] text-center">
          <button
            type="button"
            aria-label={`Disminuir cantidad de ${line.productName}`}
            onClick={() => onQuantityChange(line.quantity - 1)}
            className="min-h-12 min-w-12 border-r border-[var(--color-border)] text-xl font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-inset"
          >
            −
          </button>
          <output className="self-center px-3 font-bold tabular-nums">
            {line.quantity}
          </output>
          <button
            type="button"
            aria-label={`Aumentar cantidad de ${line.productName}`}
            onClick={() => onQuantityChange(line.quantity + 1)}
            className="min-h-12 min-w-12 border-l border-[var(--color-border)] text-xl font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-inset"
          >
            +
          </button>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="min-h-12 rounded-md border border-[var(--brand-red)] px-3 text-sm font-semibold text-[var(--brand-red)] hover:bg-[var(--status-critical-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
        >
          Quitar
        </button>
      </div>
    </article>
  );
}

function StatusPanel({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p role="status" className={`${panelClass} text-[var(--color-text-muted)]`}>
      {children}
    </p>
  );
}

function toggleId(ids: readonly string[], id: string): readonly string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

function findLocation(
  contextState: ContextState,
  locationId: string | null,
): PosOrderingContextServiceLocation | null {
  if (contextState.status !== "ready" || !locationId) return null;
  return (
    contextState.context.restaurants
      .flatMap((restaurant) => restaurant.serviceLocations)
      .find((location) => location.id === locationId) ?? null
  );
}

function findRestaurant(
  contextState: ContextState,
  locationId: string | null,
): PosOrderingContextRestaurant | null {
  if (contextState.status !== "ready" || !locationId) return null;
  return findRestaurantForLocation(contextState, locationId);
}

function findRestaurantForLocation(
  contextState: ContextState,
  locationId: string,
): PosOrderingContextRestaurant | null {
  if (contextState.status !== "ready") return null;
  return (
    contextState.context.restaurants.find((restaurant) =>
      restaurant.serviceLocations.some(
        (location) => location.id === locationId,
      ),
    ) ?? null
  );
}

function hasOrderingChoices(context: PosOrderingContext): boolean {
  return context.restaurants.some(
    (restaurant) =>
      restaurant.serviceLocations.length > 0 &&
      restaurant.categories.some((category) => category.products.length > 0),
  );
}

function isOrderingContext(value: unknown): value is PosOrderingContext {
  return (
    isRecord(value) &&
    Array.isArray(value.restaurants) &&
    value.restaurants.every(isRestaurant)
  );
}

function isRestaurant(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    Array.isArray(value.serviceLocations) &&
    value.serviceLocations.every(isServiceLocation) &&
    Array.isArray(value.categories) &&
    value.categories.every(isCategory)
  );
}

function isServiceLocation(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.type) &&
    isNumber(value.displayOrder) &&
    typeof value.allowsMultipleActiveOrders === "boolean"
  );
}

function isCategory(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isNumber(value.displayOrder) &&
    Array.isArray(value.products) &&
    value.products.every(isProduct)
  );
}

function isProduct(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.productVersionId) &&
    isNumber(value.versionNumber) &&
    isString(value.name) &&
    isString(value.printerAlias) &&
    isNumber(value.displayOrder) &&
    isNumber(value.unitPrice) &&
    isTax(value.tax) &&
    Array.isArray(value.options) &&
    value.options.every(isModification) &&
    Array.isArray(value.removableIngredients) &&
    value.removableIngredients.every(isModification)
  );
}

function isTax(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.taxRateId) &&
    isString(value.code) &&
    isString(value.name) &&
    isNumber(value.rate) &&
    typeof value.priceIncludesTax === "boolean"
  );
}

function isModification(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    (value.priceAdjustment === null || isNumber(value.priceAdjustment)) &&
    isNumber(value.displayOrder)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat("es-EC", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const panelClass =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5";
const inputClass =
  "mt-2 min-h-12 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2";
