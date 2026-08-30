import type {
  ActiveOrderDetail,
  ModifyOrderInput,
  OrderModificationOperationInput,
  PosOrderingContextProduct,
} from "@/application";

export type EditableOrderLine = Readonly<{
  key: string;
  origin: "persisted" | "added";
  basketId: string;
  lineId: string | null;
  expectedCurrentSnapshotId: string | null;
  productVersionId: string;
  productName: string;
  quantity: number;
  optionIds: readonly string[];
  removableIngredientIds: readonly string[];
  observations: string;
  removed: boolean;
  original: Readonly<{
    quantity: number;
    optionIds: readonly string[];
    removableIngredientIds: readonly string[];
    observations: string;
  }> | null;
}>;

export type PendingOrderEdit = Readonly<{
  order: ActiveOrderDetail;
  lines: readonly EditableOrderLine[];
}>;

export type PendingOrderEditAction =
  | Readonly<{ type: "set-quantity"; key: string; quantity: number }>
  | Readonly<{ type: "set-observations"; key: string; observations: string }>
  | Readonly<{
      type: "toggle-modification";
      key: string;
      modificationId: string;
      group: "option" | "removable-ingredient";
    }>
  | Readonly<{ type: "remove"; key: string }>
  | Readonly<{ type: "restore"; key: string }>
  | Readonly<{ type: "add"; line: EditableOrderLine }>;

export type SaveState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "pending" }>
  | Readonly<{ status: "success"; totalAmount: string | null }>
  | Readonly<{
      status: "error";
      recovery: "retry" | "reload" | "blocked";
      message: string;
    }>;

export type ModificationResponse = Readonly<{
  status: number;
  json(): Promise<unknown>;
}>;

export type ModificationTransport = (
  input: ModifyOrderInput,
) => Promise<ModificationResponse>;

export type PersistedModificationSummary = Readonly<{
  totalAmount: string | null;
  updatedAt: string | null;
}>;

export function createPendingOrderEdit(
  order: ActiveOrderDetail,
): PendingOrderEdit | null {
  if (order.status !== "PENDING") return null;

  return {
    order,
    lines: order.baskets.flatMap((basket) =>
      basket.lines.map((line) => {
        const snapshot = line.currentSnapshot;
        const configuration = {
          quantity: snapshot.quantity,
          optionIds: sortedIds(snapshot.selectedOptions.map(({ id }) => id)),
          removableIngredientIds: sortedIds(
            snapshot.removedIngredients.map(({ id }) => id),
          ),
          observations: snapshot.observations ?? "",
        };
        return {
          key: line.id,
          origin: "persisted" as const,
          basketId: basket.id,
          lineId: line.id,
          expectedCurrentSnapshotId: line.currentSnapshotId,
          productVersionId: snapshot.productVersionId,
          productName: snapshot.productName,
          ...configuration,
          removed: false,
          original: configuration,
        };
      }),
    ),
  };
}

export function createAddedOrderLine({
  key,
  basketId,
  product,
  quantity,
  optionIds,
  removableIngredientIds,
  observations,
}: Readonly<{
  key: string;
  basketId: string;
  product: PosOrderingContextProduct;
  quantity: number;
  optionIds: readonly string[];
  removableIngredientIds: readonly string[];
  observations: string;
}>): EditableOrderLine {
  return {
    key,
    origin: "added",
    basketId,
    lineId: null,
    expectedCurrentSnapshotId: null,
    productVersionId: product.productVersionId,
    productName: product.name,
    quantity: normalizeQuantity(quantity),
    optionIds: sortedIds(optionIds),
    removableIngredientIds: sortedIds(removableIngredientIds),
    observations: observations.trim(),
    removed: false,
    original: null,
  };
}

export function pendingOrderEditReducer(
  state: PendingOrderEdit,
  action: PendingOrderEditAction,
): PendingOrderEdit {
  if (action.type === "add") {
    return { ...state, lines: [...state.lines, action.line] };
  }

  if (action.type === "remove") {
    const line = state.lines.find(({ key }) => key === action.key);
    if (!line) return state;
    return line.origin === "added"
      ? { ...state, lines: state.lines.filter(({ key }) => key !== action.key) }
      : updateLine(state, action.key, (current) => ({
          ...current,
          removed: true,
        }));
  }

  if (action.type === "restore") {
    return updateLine(state, action.key, (line) => ({
      ...line,
      removed: false,
    }));
  }

  if (action.type === "set-quantity") {
    return updateLine(state, action.key, (line) => ({
      ...line,
      quantity: normalizeQuantity(action.quantity),
    }));
  }

  if (action.type === "set-observations") {
    return updateLine(state, action.key, (line) => ({
      ...line,
      observations: action.observations,
    }));
  }

  return updateLine(state, action.key, (line) => {
    const field =
      action.group === "option" ? "optionIds" : "removableIngredientIds";
    return {
      ...line,
      [field]: toggleId(line[field], action.modificationId),
    };
  });
}

export function applyPendingOrderEdit(
  state: PendingOrderEdit,
  action: PendingOrderEditAction,
  saveState: SaveState,
): PendingOrderEdit {
  return recoveryRequiresReload(saveState)
    ? state
    : pendingOrderEditReducer(state, action);
}

export function toModificationInput(
  edit: PendingOrderEdit,
): ModifyOrderInput | null {
  const operations = edit.lines.flatMap(toOperation);
  if (operations.length === 0) return null;

  return Object.freeze({
    orderId: edit.order.id,
    expectedUpdatedAt: edit.order.updatedAt,
    operations: Object.freeze(operations),
  });
}

export function modificationSummary(edit: PendingOrderEdit): readonly string[] {
  return edit.lines.flatMap((line) => {
    if (line.origin === "added") {
      return [`Agregar ${line.quantity} × ${line.productName}`];
    }
    if (line.removed) return [`Quitar ${line.productName}`];
    return isChanged(line) ? [`Actualizar ${line.productName}`] : [];
  });
}

export function saveActionState(
  state: SaveState,
  input: ModifyOrderInput | null,
): Readonly<{ disabled: boolean; label: string }> {
  const pending = state.status === "pending";
  const persisted = state.status === "success";
  const blocked = recoveryRequiresReload(state);
  return {
    disabled: input === null || pending || persisted || blocked,
    label: pending ? "Guardando cambios…" : "Guardar cambios",
  };
}

export function recoveryRequiresReload(state: SaveState): boolean {
  return state.status === "error" && state.recovery !== "retry";
}

export class ActiveOrderSaveWorkflow {
  private inFlight = false;
  private reloadRequired = false;

  constructor(
    private readonly transport: ModificationTransport,
    private readonly onStateChange: (state: SaveState) => void,
    private readonly onPersisted: (
      summary: PersistedModificationSummary,
      input: ModifyOrderInput,
    ) => void | Promise<void>,
  ) {}

  async submit(input: ModifyOrderInput | null): Promise<void> {
    if (input === null || this.inFlight || this.reloadRequired) return;
    this.inFlight = true;
    this.onStateChange({ status: "pending" });

    let response: ModificationResponse;
    try {
      response = await this.transport(input);
    } catch {
      this.fail(
        "retry",
        "No se pudo conectar. Tus cambios siguen disponibles para reintentar.",
      );
      return;
    }

    if (response.status !== 200) {
      let code: string | null = null;
      try {
        code = errorCode(await response.json());
      } catch {
        // Status-based feedback remains safe when an error body is malformed.
      }
      const failure = modificationFailure(response.status, code);
      this.reloadRequired = failure.recovery !== "retry";
      this.fail(failure.recovery, failure.message);
      return;
    }

    let summary: PersistedModificationSummary = {
      totalAmount: null,
      updatedAt: null,
    };
    try {
      summary = persistedSummary(await response.json());
    } catch {
      // A 200 means the mutation persisted; never invite a duplicate retry.
    }

    this.inFlight = false;
    this.onStateChange({
      status: "success",
      totalAmount: summary.totalAmount,
    });
    await this.onPersisted(summary, input);
  }

  resetAfterReload(): void {
    this.reloadRequired = false;
  }

  private fail(recovery: "retry" | "reload" | "blocked", message: string) {
    this.inFlight = false;
    this.onStateChange({ status: "error", recovery, message });
  }
}

export function modificationFailure(
  status: number,
  code: string | null,
): Extract<SaveState, { status: "error" }> {
  if (status === 401 || status === 403 || code === "UNAUTHORIZED") {
    return {
      status: "error",
      recovery: "blocked",
      message: "No tienes permiso para editar esta orden.",
    };
  }
  if (status === 404 || code === "NOT_FOUND") {
    return {
      status: "error",
      recovery: "blocked",
      message: "La orden ya no está disponible.",
    };
  }
  if (code === "ORDER_NOT_PENDING") {
    return {
      status: "error",
      recovery: "blocked",
      message: "La orden ya no está pendiente y no puede editarse.",
    };
  }
  if (code === "STALE_ORDER") {
    return {
      status: "error",
      recovery: "reload",
      message:
        "La orden cambió en otra pantalla. Recárgala antes de guardar nuevos cambios.",
    };
  }
  if (code === "STALE_CONFIGURATION") {
    return {
      status: "error",
      recovery: "reload",
      message:
        "El menú cambió desde que cargaste la orden. Recarga la orden y revísala.",
    };
  }
  if (code === "INSUFFICIENT_INVENTORY") {
    return {
      status: "error",
      recovery: "retry",
      message:
        "No hay inventario suficiente para esos cambios. Ajusta los productos e inténtalo de nuevo.",
    };
  }
  if (status === 422 || code === "INVALID_MODIFICATION") {
    return {
      status: "error",
      recovery: "retry",
      message: "Revisa las cantidades y modificaciones antes de guardar.",
    };
  }
  return {
    status: "error",
    recovery: "retry",
    message: "No se pudieron guardar los cambios. Inténtalo de nuevo.",
  };
}

function toOperation(
  line: EditableOrderLine,
): readonly OrderModificationOperationInput[] {
  if (line.origin === "added") {
    return line.removed
      ? []
      : [
          {
            kind: "add",
            basketId: line.basketId,
            clientCorrelationId: line.key,
            productVersionId: line.productVersionId,
            ...configuration(line),
          },
        ];
  }
  if (line.lineId === null || line.expectedCurrentSnapshotId === null)
    return [];
  if (line.removed) {
    return [
      {
        kind: "remove",
        lineId: line.lineId,
        expectedCurrentSnapshotId: line.expectedCurrentSnapshotId,
      },
    ];
  }
  return isChanged(line)
    ? [
        {
          kind: "replace",
          lineId: line.lineId,
          expectedCurrentSnapshotId: line.expectedCurrentSnapshotId,
          ...configuration(line),
        },
      ]
    : [];
}

function configuration(line: EditableOrderLine) {
  return {
    quantity: line.quantity,
    optionIds: sortedIds(line.optionIds),
    removableIngredientIds: sortedIds(line.removableIngredientIds),
    observations: line.observations.trim() || null,
  };
}

function isChanged(line: EditableOrderLine): boolean {
  if (line.original === null) return true;
  const current = configuration(line);
  return (
    current.quantity !== line.original.quantity ||
    current.observations !== (line.original.observations.trim() || null) ||
    current.optionIds.join("|") !== line.original.optionIds.join("|") ||
    current.removableIngredientIds.join("|") !==
      line.original.removableIngredientIds.join("|")
  );
}

function updateLine(
  state: PendingOrderEdit,
  key: string,
  update: (line: EditableOrderLine) => EditableOrderLine,
): PendingOrderEdit {
  return {
    ...state,
    lines: state.lines.map((line) => (line.key === key ? update(line) : line)),
  };
}

function toggleId(ids: readonly string[], id: string): readonly string[] {
  return ids.includes(id)
    ? ids.filter((value) => value !== id)
    : sortedIds([...ids, id]);
}

function sortedIds(ids: readonly string[]): readonly string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function normalizeQuantity(value: number): number {
  return Number.isSafeInteger(value) ? Math.max(1, value) : 1;
}

function errorCode(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "code" in value.error &&
    typeof value.error.code === "string"
  ) {
    return value.error.code;
  }
  return null;
}

function persistedSummary(value: unknown): PersistedModificationSummary {
  if (typeof value !== "object" || value === null) {
    return { totalAmount: null, updatedAt: null };
  }
  return {
    totalAmount:
      "totalAmount" in value && typeof value.totalAmount === "string"
        ? value.totalAmount
        : null,
    updatedAt:
      "updatedAt" in value && typeof value.updatedAt === "string"
        ? value.updatedAt
        : null,
  };
}
