"use client";

import { useEffect, useRef, useState } from "react";

import type {
  ActiveOrderDetail,
  ActiveOrderLineSnapshot,
  ActiveOrderListItem,
  ModifyOrderInput,
  PosOrderingContext,
  PosOrderingContextModification,
  PosOrderingContextProduct,
} from "@/application";

import {
  ActiveOrderSaveWorkflow,
  applyPendingOrderEdit,
  createAddedOrderLine,
  createPendingOrderEdit,
  modificationSummary,
  pendingOrderEditReducer,
  recoveryRequiresReload,
  saveActionState,
  toModificationInput,
  type EditableOrderLine,
  type PendingOrderEdit,
  type SaveState,
} from "./active-order-editing";

type OrdersState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; orders: readonly ActiveOrderListItem[] }>;

type ContextState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{ status: "ready"; context: PosOrderingContext }>;

type DetailState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "readonly"; order: ActiveOrderDetail }>
  | Readonly<{ status: "ready"; edit: PendingOrderEdit }>;

const selectedButtonClass =
  "border-[var(--brand-green)] bg-[var(--status-new-bg)] font-bold";
const neutralButtonClass =
  "border-[var(--color-border-strong)] bg-white hover:bg-[var(--color-surface-muted)]";
const touchButtonClass =
  "min-h-12 rounded-md border px-3 py-2 text-left text-base font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const panelClass =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5";
const inputClass =
  "mt-2 min-h-12 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--color-surface-muted)]";

export function ActiveOrderEditor() {
  const [ordersState, setOrdersState] = useState<OrdersState>({
    status: "loading",
  });
  const [contextState, setContextState] = useState<ContextState>({
    status: "loading",
  });
  const [detailState, setDetailState] = useState<DetailState>({
    status: "idle",
  });
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [selectedBasketId, setSelectedBasketId] = useState("");
  const [selectedProductVersionId, setSelectedProductVersionId] = useState("");
  const [addQuantity, setAddQuantity] = useState(1);
  const [addOptionIds, setAddOptionIds] = useState<readonly string[]>([]);
  const [addRemovalIds, setAddRemovalIds] = useState<readonly string[]>([]);
  const [addObservations, setAddObservations] = useState("");
  const [nextCorrelation, setNextCorrelation] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const saveWorkflow = useRef<ActiveOrderSaveWorkflow | null>(null);

  async function loadOrders(signal?: AbortSignal, showLoading = true) {
    if (showLoading) setOrdersState({ status: "loading" });
    try {
      const orders = await requestActiveOrders(signal);
      setOrdersState({ status: "ready", orders });
    } catch (error) {
      if (!signal?.aborted) {
        setOrdersState({
          status: "error",
          message: activeOrdersFailureMessage(error),
        });
      }
    }
  }

  async function loadDetail(orderId: string, resetSave = true) {
    if (resetSave && saveState.status === "pending") return;
    const preservingRecovery = recoveryRequiresReload(saveState);
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setSelectedOrderId(orderId);
    if (resetSave) {
      setDetailState({ status: "loading" });
      if (!preservingRecovery) setSaveState({ status: "idle" });
    }
    try {
      const response = await fetch(`/api/v1/pos/orders/${orderId}`, {
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        setDetailState({
          status: "error",
          message: "No tienes permiso para consultar esta orden.",
        });
        return;
      }
      if (response.status === 404) {
        setDetailState({
          status: "error",
          message: "La orden ya no está disponible.",
        });
        void loadOrders(undefined, false);
        return;
      }
      if (!response.ok) throw new Error("order detail request failed");
      const order = activeOrderDetail(await response.json());
      if (order === null) throw new Error("invalid order detail response");
      const edit = createPendingOrderEdit(order);
      if (edit === null) {
        setDetailState({ status: "readonly", order });
        saveWorkflow.current?.resetAfterReload();
        if (resetSave && preservingRecovery) setSaveState({ status: "idle" });
        void loadOrders(undefined, false);
        return;
      }
      setSelectedBasketId(edit.order.baskets[0]?.id ?? "");
      setDetailState({ status: "ready", edit });
      saveWorkflow.current?.resetAfterReload();
      if (resetSave && preservingRecovery) setSaveState({ status: "idle" });
    } catch {
      if (controller.signal.aborted) return;
      setDetailState({
        status: "error",
        message: "No se pudo cargar la orden. Inténtalo de nuevo.",
      });
    }
  }

  async function reloadOrder(orderId: string) {
    if (recoveryRequiresReload(saveState)) {
      setContextState({ status: "loading" });
      try {
        const context = await requestOrderingContext();
        setContextState({ status: "ready", context });
      } catch {
        setContextState({ status: "error" });
        return;
      }
    }
    await loadDetail(orderId);
  }

  useEffect(() => {
    const controller = new AbortController();
    void requestActiveOrders(controller.signal)
      .then((orders) => setOrdersState({ status: "ready", orders }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setOrdersState({
            status: "error",
            message: activeOrdersFailureMessage(error),
          });
        }
      });
    void requestOrderingContext(controller.signal)
      .then((context) => setContextState({ status: "ready", context }))
      .catch(() => {
        if (!controller.signal.aborted) setContextState({ status: "error" });
      });
    return () => {
      controller.abort();
      detailRequest.current?.abort();
    };
  }, []);

  const pendingOrders =
    ordersState.status === "ready"
      ? ordersState.orders.filter(({ status }) => status === "PENDING")
      : [];
  const edit = detailState.status === "ready" ? detailState.edit : null;
  const modificationInput = edit === null ? null : toModificationInput(edit);
  const changes = edit === null ? [] : modificationSummary(edit);
  const saveAction = saveActionState(saveState, modificationInput);
  const recoveryLocked = recoveryRequiresReload(saveState);
  const interactionDisabled = saveState.status === "pending" || recoveryLocked;
  const restaurant =
    contextState.status === "ready" && edit !== null
      ? (contextState.context.restaurants.find(
          ({ id }) => id === edit.order.restaurantId,
        ) ?? null)
      : null;
  const selectedProduct = findProduct(
    restaurant?.categories.flatMap(({ products }) => products) ?? [],
    selectedProductVersionId,
  );

  function dispatch(action: Parameters<typeof pendingOrderEditReducer>[1]) {
    if (recoveryRequiresReload(saveState)) return;
    setDetailState((current) =>
      current.status === "ready"
        ? {
            status: "ready",
            edit: applyPendingOrderEdit(current.edit, action, saveState),
          }
        : current,
    );
    if (saveState.status !== "pending") setSaveState({ status: "idle" });
  }

  function selectAddProduct(product: PosOrderingContextProduct) {
    setSelectedProductVersionId(product.productVersionId);
    setAddQuantity(1);
    setAddOptionIds([]);
    setAddRemovalIds([]);
    setAddObservations("");
  }

  function addProduct() {
    if (selectedProduct === null || selectedBasketId.length === 0) return;
    dispatch({
      type: "add",
      line: createAddedOrderLine({
        key: `active-edit-${edit?.order.id ?? "order"}-${nextCorrelation}`,
        basketId: selectedBasketId,
        product: selectedProduct,
        quantity: addQuantity,
        optionIds: addOptionIds,
        removableIngredientIds: addRemovalIds,
        observations: addObservations,
      }),
    });
    setNextCorrelation((current) => current + 1);
    setSelectedProductVersionId("");
    setAddQuantity(1);
    setAddOptionIds([]);
    setAddRemovalIds([]);
    setAddObservations("");
  }

  function saveOrder(input: ModifyOrderInput | null) {
    if (saveWorkflow.current === null) {
      saveWorkflow.current = new ActiveOrderSaveWorkflow(
        async (modification) =>
          fetch(`/api/v1/pos/orders/${modification.orderId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(modification),
          }),
        setSaveState,
        async (_summary, persistedInput) => {
          await loadDetail(persistedInput.orderId, false);
          void loadOrders(undefined, false);
        },
      );
    }
    void saveWorkflow.current.submit(input);
  }

  return (
    <div>
      <header>
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Punto de venta
        </p>
        <h1 className="mt-2 text-3xl font-bold">Editar orden activa</h1>
        <p className="mt-2 max-w-4xl text-[var(--color-text-muted)]">
          Carga una orden pendiente, revisa todos los cambios y guárdalos una
          sola vez. Cocina y los demás paneles recibirán la actualización.
        </p>
      </header>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.75fr)]">
        <aside className={panelClass} aria-labelledby="active-orders-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="active-orders-title" className="text-xl font-bold">
              Órdenes pendientes
            </h2>
            <button
              type="button"
              disabled={interactionDisabled}
              onClick={() => void loadOrders()}
              className={`${touchButtonClass} ${neutralButtonClass}`}
            >
              Actualizar
            </button>
          </div>
          {ordersState.status === "loading" ? (
            <p role="status" className="mt-4 text-[var(--color-text-muted)]">
              Cargando órdenes pendientes…
            </p>
          ) : ordersState.status === "error" ? (
            <p role="alert" className={errorClass}>
              {ordersState.message}
            </p>
          ) : pendingOrders.length === 0 ? (
            <p role="status" className="mt-4 text-[var(--color-text-muted)]">
              No hay órdenes pendientes disponibles para editar.
            </p>
          ) : (
            <div className="mt-4 grid gap-3">
              {pendingOrders.map((order) => (
                <article
                  key={order.id}
                  className="rounded-md border border-[var(--color-border)] bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold">Orden {order.orderNumber}</h3>
                      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                        {order.serviceLocation.name} ·{" "}
                        {order.assignedWaiter.displayName}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="rounded-sm bg-[var(--status-new-bg)] px-2 py-1 text-xs font-bold text-[var(--status-new)]">
                        Pendiente
                      </span>
                      <OrderAge createdAt={order.createdAt} />
                    </div>
                  </div>
                  <p className="mt-2 font-semibold tabular-nums">
                    {formatAmount(order.totalAmount)}
                  </p>
                  <button
                    type="button"
                    disabled={interactionDisabled}
                    onClick={() => void loadDetail(order.id)}
                    aria-pressed={selectedOrderId === order.id}
                    className={`mt-3 w-full ${touchButtonClass} ${selectedOrderId === order.id ? selectedButtonClass : neutralButtonClass}`}
                  >
                    Cargar orden
                  </button>
                </article>
              ))}
            </div>
          )}
        </aside>

        <section aria-label="Edición de orden activa">
          {detailState.status === "idle" ? (
            <StatusPanel>
              Selecciona una orden pendiente para revisar sus cuentas y
              productos.
            </StatusPanel>
          ) : detailState.status === "loading" ? (
            <StatusPanel>Cargando detalle de la orden…</StatusPanel>
          ) : detailState.status === "error" ? (
            <div className={panelClass}>
              <p role="alert" className="text-[var(--status-critical)]">
                {detailState.message}
              </p>
              {recoveryLocked && selectedOrderId !== null ? (
                <button
                  type="button"
                  onClick={() => void reloadOrder(selectedOrderId)}
                  className={`mt-4 ${touchButtonClass} ${neutralButtonClass}`}
                >
                  Reintentar recarga
                </button>
              ) : null}
            </div>
          ) : detailState.status === "readonly" ? (
            <div className={panelClass}>
              <p
                role="alert"
                className="font-semibold text-[var(--status-critical)]"
              >
                La orden {detailState.order.orderNumber} está en estado{" "}
                {statusLabel(detailState.order.status)} y ya no puede editarse.
              </p>
              <button
                type="button"
                onClick={() => void loadOrders()}
                className={`mt-4 ${touchButtonClass} ${neutralButtonClass}`}
              >
                Volver a órdenes pendientes
              </button>
            </div>
          ) : (
            <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.65fr)]">
              <div className="grid gap-5">
                <OrderHeading edit={detailState.edit} />
                {detailState.edit.order.baskets.map((basket, index) => (
                  <section
                    key={basket.id}
                    className={panelClass}
                    aria-labelledby={`basket-${basket.id}`}
                  >
                    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-3">
                      <h2
                        id={`basket-${basket.id}`}
                        className="text-xl font-bold"
                      >
                        Cuenta {index + 1}
                      </h2>
                      <span className="font-semibold tabular-nums">
                        {formatAmount(basket.totalAmount)}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4">
                      {detailState.edit.lines
                        .filter(({ basketId }) => basketId === basket.id)
                        .map((line) => (
                          <EditableLineCard
                            key={line.key}
                            line={line}
                            snapshot={findSnapshot(
                              detailState.edit.order,
                              line.lineId,
                            )}
                            product={findProduct(
                              restaurant?.categories.flatMap(
                                ({ products }) => products,
                              ) ?? [],
                              line.productVersionId,
                            )}
                            disabled={interactionDisabled}
                            onDispatch={dispatch}
                          />
                        ))}
                    </div>
                  </section>
                ))}
                <AddProductPanel
                  edit={detailState.edit}
                  restaurant={restaurant}
                  contextState={contextState}
                  basketId={selectedBasketId}
                  product={selectedProduct}
                  quantity={addQuantity}
                  optionIds={addOptionIds}
                  removalIds={addRemovalIds}
                  observations={addObservations}
                  disabled={interactionDisabled}
                  onBasketChange={setSelectedBasketId}
                  onProductSelect={selectAddProduct}
                  onQuantityChange={setAddQuantity}
                  onOptionToggle={(id) =>
                    setAddOptionIds((ids) => toggleId(ids, id))
                  }
                  onRemovalToggle={(id) =>
                    setAddRemovalIds((ids) => toggleId(ids, id))
                  }
                  onObservationsChange={setAddObservations}
                  onAdd={addProduct}
                />
              </div>

              <aside
                className={`${panelClass} 2xl:sticky 2xl:top-24 2xl:self-start`}
                aria-labelledby="change-review-title"
              >
                <h2 id="change-review-title" className="text-xl font-bold">
                  Revisar cambios
                </h2>
                <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                  Total actual del servidor
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {formatAmount(detailState.edit.order.totalAmount)}
                </p>
                {changes.length === 0 ? (
                  <p
                    role="status"
                    className="mt-4 text-sm text-[var(--color-text-muted)]"
                  >
                    Aún no hiciste cambios.
                  </p>
                ) : (
                  <ul className="mt-4 grid gap-2 text-sm">
                    {changes.map((change, index) => (
                      <li
                        key={`${change}-${index}`}
                        className="rounded-md bg-[var(--color-surface-muted)] p-2"
                      >
                        {change}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-4 text-xs text-[var(--color-text-muted)]">
                  El servidor volverá a calcular precios, impuestos e inventario
                  al guardar.
                </p>
                <button
                  type="button"
                  disabled={saveAction.disabled}
                  aria-describedby="active-order-save-feedback"
                  onClick={() => saveOrder(modificationInput)}
                  className="mt-5 min-h-12 w-full rounded-md bg-[var(--brand-green)] px-4 font-bold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saveAction.label}
                </button>
                <SaveFeedback state={saveState} />
                {saveState.status === "error" &&
                (saveState.recovery === "reload" ||
                  saveState.recovery === "blocked") ? (
                  <button
                    type="button"
                    onClick={() => void reloadOrder(detailState.edit.order.id)}
                    className={`mt-3 w-full ${touchButtonClass} ${neutralButtonClass}`}
                  >
                    Recargar orden
                  </button>
                ) : null}
              </aside>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function OrderHeading({ edit }: Readonly<{ edit: PendingOrderEdit }>) {
  return (
    <section className={panelClass} aria-labelledby="loaded-order-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--brand-green)]">
            Pendiente
          </p>
          <h2 id="loaded-order-title" className="mt-1 text-2xl font-bold">
            Orden {edit.order.orderNumber}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {edit.order.serviceLocation.name} ·{" "}
            {edit.order.assignedWaiter.displayName}
          </p>
        </div>
        <p className="text-right text-sm text-[var(--color-text-muted)]">
          Última actualización
          <span className="mt-1 block font-semibold text-[var(--color-text)]">
            {formatDateTime(edit.order.updatedAt)}
          </span>
        </p>
      </div>
    </section>
  );
}

function OrderAge({ createdAt }: Readonly<{ createdAt: string }>) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setNow(Date.now());
    const initial = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, []);

  const age = elapsedAge(createdAt, now);
  return (
    <time
      dateTime={createdAt}
      aria-label={`Antigüedad de la orden: ${age.accessible}`}
      className="mt-2 block text-sm font-bold tabular-nums text-[var(--color-text)]"
    >
      {age.visible}
    </time>
  );
}

function EditableLineCard({
  line,
  snapshot,
  product,
  disabled,
  onDispatch,
}: Readonly<{
  line: EditableOrderLine;
  snapshot: ActiveOrderLineSnapshot | null;
  product: PosOrderingContextProduct | null;
  disabled: boolean;
  onDispatch(action: Parameters<typeof pendingOrderEditReducer>[1]): void;
}>) {
  if (line.removed) {
    return (
      <article className="rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-3">
        <p className="font-semibold">{line.productName}</p>
        <p className="mt-1 text-sm text-[var(--status-critical)]">
          Este producto se quitará al guardar.
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onDispatch({ type: "restore", key: line.key })}
          className={`mt-3 ${touchButtonClass} ${neutralButtonClass}`}
        >
          Restaurar
        </button>
      </article>
    );
  }

  return (
    <article className="rounded-md border border-[var(--color-border)] bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{line.productName}</h3>
          {line.origin === "added" ? (
            <span className="mt-1 inline-block rounded-sm bg-[var(--status-new-bg)] px-2 py-1 text-xs font-bold text-[var(--status-new)]">
              Nuevo
            </span>
          ) : null}
        </div>
        {snapshot ? (
          <span className="font-semibold tabular-nums">
            {formatAmount(snapshot.lineTotal)}
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-[auto_minmax(12rem,1fr)]">
        <QuantityControl
          label={line.productName}
          quantity={line.quantity}
          disabled={disabled}
          onChange={(quantity) =>
            onDispatch({ type: "set-quantity", key: line.key, quantity })
          }
        />
        <label className="text-sm font-semibold">
          Observaciones
          <textarea
            value={line.observations}
            maxLength={2000}
            rows={2}
            disabled={disabled}
            onChange={(event) =>
              onDispatch({
                type: "set-observations",
                key: line.key,
                observations: event.target.value,
              })
            }
            className={inputClass}
          />
        </label>
      </div>
      {product ? (
        <div className="mt-3 grid gap-3">
          <ModificationButtons
            title="Opciones"
            modifications={product.options}
            selectedIds={line.optionIds}
            disabled={disabled}
            onToggle={(modificationId) =>
              onDispatch({
                type: "toggle-modification",
                key: line.key,
                group: "option",
                modificationId,
              })
            }
          />
          <ModificationButtons
            title="Ingredientes a retirar"
            modifications={product.removableIngredients}
            selectedIds={line.removableIngredientIds}
            disabled={disabled}
            onToggle={(modificationId) =>
              onDispatch({
                type: "toggle-modification",
                key: line.key,
                group: "removable-ingredient",
                modificationId,
              })
            }
          />
        </div>
      ) : (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          La configuración de este producto no está en el menú activo. Puedes
          cambiar su cantidad u observación conservando sus modificaciones
          actuales.
        </p>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onDispatch({ type: "remove", key: line.key })}
        className="mt-4 min-h-12 rounded-md border border-[var(--brand-red)] px-3 text-sm font-semibold text-[var(--brand-red)] hover:bg-[var(--status-critical-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Quitar producto
      </button>
    </article>
  );
}

function AddProductPanel({
  edit,
  restaurant,
  contextState,
  basketId,
  product,
  quantity,
  optionIds,
  removalIds,
  observations,
  disabled,
  onBasketChange,
  onProductSelect,
  onQuantityChange,
  onOptionToggle,
  onRemovalToggle,
  onObservationsChange,
  onAdd,
}: Readonly<{
  edit: PendingOrderEdit;
  restaurant: PosOrderingContext["restaurants"][number] | null;
  contextState: ContextState;
  basketId: string;
  product: PosOrderingContextProduct | null;
  quantity: number;
  optionIds: readonly string[];
  removalIds: readonly string[];
  observations: string;
  disabled: boolean;
  onBasketChange(value: string): void;
  onProductSelect(product: PosOrderingContextProduct): void;
  onQuantityChange(value: number): void;
  onOptionToggle(id: string): void;
  onRemovalToggle(id: string): void;
  onObservationsChange(value: string): void;
  onAdd(): void;
}>) {
  return (
    <section className={panelClass} aria-labelledby="add-product-title">
      <h2 id="add-product-title" className="text-xl font-bold">
        Agregar producto
      </h2>
      {contextState.status === "loading" ? (
        <p role="status" className="mt-3 text-[var(--color-text-muted)]">
          Cargando menú activo…
        </p>
      ) : contextState.status === "error" || restaurant === null ? (
        <p role="alert" className={errorClass}>
          No se pudo cargar el menú activo. Los productos actuales todavía
          pueden editarse.
        </p>
      ) : (
        <>
          <label className="mt-4 block text-sm font-semibold">
            Cuenta
            <select
              value={basketId}
              disabled={disabled}
              onChange={(event) => onBasketChange(event.target.value)}
              className={inputClass}
            >
              {edit.order.baskets.map((basket, index) => (
                <option key={basket.id} value={basket.id}>
                  Cuenta {index + 1}
                </option>
              ))}
            </select>
          </label>
          {restaurant.categories.map((category) => (
            <fieldset key={category.id} className="mt-4">
              <legend className="text-sm font-semibold">{category.name}</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {category.products.map((candidate) => (
                  <button
                    key={candidate.productVersionId}
                    type="button"
                    disabled={disabled}
                    aria-pressed={
                      product?.productVersionId === candidate.productVersionId
                    }
                    onClick={() => onProductSelect(candidate)}
                    className={`${touchButtonClass} ${product?.productVersionId === candidate.productVersionId ? selectedButtonClass : neutralButtonClass}`}
                  >
                    <span className="block">{candidate.name}</span>
                    <span className="block text-sm font-normal tabular-nums text-[var(--color-text-muted)]">
                      {formatAmount(candidate.unitPrice)}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          {product ? (
            <div className="mt-5 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] p-4">
              <h3 className="font-bold">Configurar {product.name}</h3>
              <ModificationButtons
                title="Opciones"
                modifications={product.options}
                selectedIds={optionIds}
                disabled={disabled}
                onToggle={onOptionToggle}
              />
              <ModificationButtons
                title="Ingredientes a retirar"
                modifications={product.removableIngredients}
                selectedIds={removalIds}
                disabled={disabled}
                onToggle={onRemovalToggle}
              />
              <label className="mt-3 block text-sm font-semibold">
                Observaciones
                <textarea
                  value={observations}
                  maxLength={2000}
                  rows={2}
                  disabled={disabled}
                  onChange={(event) => onObservationsChange(event.target.value)}
                  className={inputClass}
                />
              </label>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <QuantityControl
                  label={product.name}
                  quantity={quantity}
                  disabled={disabled}
                  onChange={onQuantityChange}
                />
                <button
                  type="button"
                  disabled={disabled || basketId.length === 0}
                  onClick={onAdd}
                  className="min-h-12 flex-1 rounded-md bg-[var(--brand-green)] px-4 font-bold text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Agregar a la orden
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function ModificationButtons({
  title,
  modifications,
  selectedIds,
  disabled,
  onToggle,
}: Readonly<{
  title: string;
  modifications: readonly PosOrderingContextModification[];
  selectedIds: readonly string[];
  disabled: boolean;
  onToggle(id: string): void;
}>) {
  if (modifications.length === 0) return null;
  return (
    <fieldset className="mt-3">
      <legend className="text-sm font-semibold">{title}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {modifications.map((modification) => (
          <button
            key={modification.id}
            type="button"
            disabled={disabled}
            aria-pressed={selectedIds.includes(modification.id)}
            onClick={() => onToggle(modification.id)}
            className={`${touchButtonClass} ${selectedIds.includes(modification.id) ? selectedButtonClass : neutralButtonClass}`}
          >
            {modification.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function QuantityControl({
  label,
  quantity,
  disabled,
  onChange,
}: Readonly<{
  label: string;
  quantity: number;
  disabled: boolean;
  onChange(value: number): void;
}>) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Cantidad</p>
      <div className="grid min-h-12 grid-cols-3 rounded-md border border-[var(--color-border-strong)] bg-white text-center">
        <button
          type="button"
          disabled={disabled || quantity <= 1}
          aria-label={`Disminuir cantidad de ${label}`}
          onClick={() => onChange(quantity - 1)}
          className="min-h-12 min-w-12 border-r border-[var(--color-border)] text-xl font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-inset disabled:cursor-not-allowed disabled:opacity-50"
        >
          −
        </button>
        <output
          aria-label={`Cantidad de ${label}`}
          className="self-center px-3 font-bold tabular-nums"
        >
          {quantity}
        </output>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Aumentar cantidad de ${label}`}
          onClick={() => onChange(quantity + 1)}
          className="min-h-12 min-w-12 border-l border-[var(--color-border)] text-xl font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-inset disabled:cursor-not-allowed disabled:opacity-50"
        >
          +
        </button>
      </div>
    </div>
  );
}

function SaveFeedback({ state }: Readonly<{ state: SaveState }>) {
  if (state.status === "idle" || state.status === "pending") {
    return <p id="active-order-save-feedback" className="sr-only" />;
  }
  if (state.status === "success") {
    return (
      <p
        id="active-order-save-feedback"
        role="status"
        className="mt-3 rounded-md border border-[var(--status-new)] bg-[var(--status-new-bg)] p-3 text-sm font-semibold text-[var(--status-new)]"
      >
        {state.totalAmount === null
          ? "Cambios guardados y sincronizados. La orden se recargó."
          : `Cambios guardados y sincronizados. Nuevo total: ${formatAmount(state.totalAmount)}.`}
      </p>
    );
  }
  return (
    <p id="active-order-save-feedback" role="alert" className={errorClass}>
      {state.message}
    </p>
  );
}

function StatusPanel({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p role="status" className={`${panelClass} text-[var(--color-text-muted)]`}>
      {children}
    </p>
  );
}

function findProduct(
  products: readonly PosOrderingContextProduct[],
  productVersionId: string,
): PosOrderingContextProduct | null {
  return (
    products.find((product) => product.productVersionId === productVersionId) ??
    null
  );
}

function findSnapshot(
  order: ActiveOrderDetail,
  lineId: string | null,
): ActiveOrderLineSnapshot | null {
  if (lineId === null) return null;
  return (
    order.baskets.flatMap(({ lines }) => lines).find(({ id }) => id === lineId)
      ?.currentSnapshot ?? null
  );
}

function toggleId(ids: readonly string[], id: string): readonly string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

class ActiveOrdersAccessError extends Error {}

async function requestActiveOrders(
  signal?: AbortSignal,
): Promise<readonly ActiveOrderListItem[]> {
  const response = await fetch("/api/v1/pos/orders", { signal });
  if (response.status === 401 || response.status === 403) {
    throw new ActiveOrdersAccessError();
  }
  if (!response.ok) throw new Error("active orders request failed");
  const orders = activeOrderList(await response.json());
  if (orders === null) throw new Error("invalid active orders response");
  return orders;
}

function activeOrdersFailureMessage(error: unknown): string {
  return error instanceof ActiveOrdersAccessError
    ? "No tienes permiso para consultar órdenes activas."
    : "No se pudieron cargar las órdenes activas. Inténtalo de nuevo.";
}

async function requestOrderingContext(
  signal?: AbortSignal,
): Promise<PosOrderingContext> {
  const response = await fetch("/api/v1/pos/ordering-context", { signal });
  if (!response.ok) throw new Error("ordering context request failed");
  const context = orderingContext(await response.json());
  if (context === null) throw new Error("invalid ordering context response");
  return context;
}

function activeOrderList(
  value: unknown,
): readonly ActiveOrderListItem[] | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.orders) ||
    !value.orders.every(isActiveOrderListItem)
  )
    return null;
  return value.orders as unknown as readonly ActiveOrderListItem[];
}

function activeOrderDetail(value: unknown): ActiveOrderDetail | null {
  if (
    !isActiveOrderBase(value) ||
    !Array.isArray(value.baskets) ||
    !value.baskets.every(isActiveOrderBasket)
  )
    return null;
  return value as unknown as ActiveOrderDetail;
}

function isActiveOrderListItem(value: unknown): boolean {
  return isActiveOrderBase(value) && Array.isArray(value.baskets);
}

function isActiveOrderBase(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.restaurantId) &&
    isString(value.orderNumber) &&
    isString(value.status) &&
    isString(value.totalAmount) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    isRecord(value.serviceLocation) &&
    isString(value.serviceLocation.id) &&
    isString(value.serviceLocation.name) &&
    isRecord(value.assignedWaiter) &&
    isString(value.assignedWaiter.id) &&
    isString(value.assignedWaiter.displayName)
  );
}

function isActiveOrderBasket(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.totalAmount) &&
    Array.isArray(value.lines) &&
    value.lines.every(isActiveOrderLine)
  );
}

function isActiveOrderLine(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.currentSnapshotId) &&
    isActiveOrderSnapshot(value.currentSnapshot)
  );
}

function isActiveOrderSnapshot(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.productVersionId) &&
    isString(value.productName) &&
    typeof value.quantity === "number" &&
    isString(value.lineTotal) &&
    (value.observations === null || isString(value.observations)) &&
    Array.isArray(value.selectedOptions) &&
    value.selectedOptions.every(isNamedId) &&
    Array.isArray(value.removedIngredients) &&
    value.removedIngredients.every(isNamedId)
  );
}

function orderingContext(value: unknown): PosOrderingContext | null {
  if (!isRecord(value) || !Array.isArray(value.restaurants)) return null;
  const valid = value.restaurants.every(
    (restaurant) =>
      isRecord(restaurant) &&
      isString(restaurant.id) &&
      Array.isArray(restaurant.categories) &&
      restaurant.categories.every(
        (category) =>
          isRecord(category) &&
          Array.isArray(category.products) &&
          category.products.every(isContextProduct),
      ),
  );
  return valid ? (value as unknown as PosOrderingContext) : null;
}

function isContextProduct(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.productVersionId) &&
    isString(value.name) &&
    typeof value.unitPrice === "number" &&
    Array.isArray(value.options) &&
    value.options.every(isContextModification) &&
    Array.isArray(value.removableIngredients) &&
    value.removableIngredients.every(isContextModification)
  );
}

function isContextModification(value: unknown): boolean {
  return (
    isNamedId(value) &&
    (value.priceAdjustment === null ||
      typeof value.priceAdjustment === "number")
  );
}

function isNamedId(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && isString(value.id) && isString(value.name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function formatAmount(value: string | number): string {
  const amount = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("es-EC", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount)
    : "—";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("es-EC", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date)
    : "—";
}

function elapsedAge(
  createdAt: string,
  now: number | null,
): Readonly<{ visible: string; accessible: string }> {
  const created = new Date(createdAt).getTime();
  if (now === null || !Number.isFinite(created)) {
    return { visible: "Calculando…", accessible: "calculando" };
  }
  const elapsedSeconds = Math.max(0, Math.floor((now - created) / 1000));
  if (elapsedSeconds < 60) {
    return {
      visible: `${elapsedSeconds} s`,
      accessible: `${elapsedSeconds} segundos`,
    };
  }
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return {
      visible: `${elapsedMinutes} min`,
      accessible: `${elapsedMinutes} minutos`,
    };
  }
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return {
    visible: `${hours} h ${minutes} min`,
    accessible: `${hours} horas y ${minutes} minutos`,
  };
}

function statusLabel(status: ActiveOrderDetail["status"]): string {
  switch (status) {
    case "PENDING":
      return "Pendiente";
    case "READY":
      return "Lista";
    case "ON_THE_WAY":
      return "En camino";
    case "DELIVERED":
      return "Entregada";
  }
}

const errorClass =
  "mt-3 rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-3 text-sm font-semibold text-[var(--status-critical)]";
