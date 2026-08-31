export type CancellationInput = Readonly<{
  orderId: string;
  reason: string;
}>;

export type CancellationSummary = Readonly<{
  orderId: string;
  orderNumber: string | null;
  reason: string;
  cancelledAt: string | null;
}>;

export type CancellationState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "pending" }>
  | Readonly<{ status: "reconciling" }>
  | Readonly<{ status: "success"; summary: CancellationSummary }>
  | Readonly<{
      status: "error";
      recovery: "retry" | "reconcile" | "reload" | "blocked";
      message: string;
    }>;

type CancellationResponse = Readonly<{
  status: number;
  json(): Promise<unknown>;
}>;

type CancellationTransport = (
  input: CancellationInput,
) => Promise<CancellationResponse>;

type CancellationReconciliationTransport = (
  orderId: string,
) => Promise<CancellationResponse>;

export function canExposeCancellation(
  serverAuthorized: boolean,
  authorizationBlocked: boolean,
): boolean {
  return serverAuthorized && !authorizationBlocked;
}

export function cancellationActionState(
  state: CancellationState,
  reason: string,
  confirmed: boolean,
  externallyDisabled = false,
): Readonly<{ disabled: boolean; label: string }> {
  const pending = state.status === "pending";
  return {
    disabled:
      externallyDisabled ||
      pending ||
      state.status === "reconciling" ||
      state.status === "success" ||
      (state.status === "error" && state.recovery !== "retry") ||
      reason.trim().length === 0 ||
      !confirmed,
    label: pending ? "Cancelando orden…" : "Confirmar cancelación",
  };
}

export class ActiveOrderCancellationWorkflow {
  private inFlight = false;
  private completed = false;
  private reloadRequired = false;
  private indeterminateInput: CancellationInput | null = null;

  constructor(
    private readonly transport: CancellationTransport,
    private readonly reconciliationTransport: CancellationReconciliationTransport,
    private readonly onStateChange: (state: CancellationState) => void,
    private readonly onPersisted: (
      summary: CancellationSummary,
      input: CancellationInput,
    ) => void | Promise<void>,
    private readonly onAuthorizationBlocked: () => void = () => undefined,
  ) {}

  async submit(input: CancellationInput, confirmed: boolean): Promise<void> {
    const reason = input.reason.trim();
    if (
      !confirmed ||
      reason.length === 0 ||
      this.inFlight ||
      this.completed ||
      this.reloadRequired
    ) {
      return;
    }

    const normalizedInput = Object.freeze({ ...input, reason });
    this.inFlight = true;
    this.onStateChange({ status: "pending" });

    let response: CancellationResponse;
    try {
      response = await this.transport(normalizedInput);
    } catch {
      this.markIndeterminate(normalizedInput);
      return;
    }

    if (response.status !== 200) {
      let code: string | null = null;
      try {
        code = errorCode(await response.json());
      } catch {
        // Status-based feedback remains safe when an error body is malformed.
      }
      const failure = cancellationFailure(response.status, code);
      if (failure.recovery === "reconcile") {
        this.markIndeterminate(normalizedInput, failure.message);
        return;
      }
      this.reloadRequired = failure.recovery !== "retry";
      if (
        failure.recovery === "blocked" &&
        isAuthorizationFailure(response.status, code)
      ) {
        this.onAuthorizationBlocked();
      }
      this.fail(failure.recovery, failure.message);
      return;
    }

    let summary: CancellationSummary = Object.freeze({
      orderId: normalizedInput.orderId,
      orderNumber: null,
      reason: normalizedInput.reason,
      cancelledAt: null,
    });
    try {
      summary = persistedCancellationSummary(
        await response.json(),
        normalizedInput,
      );
    } catch {
      // A 200 means cancellation committed; never invite an irreversible retry.
    }

    this.inFlight = false;
    this.completed = true;
    this.onStateChange({ status: "success", summary });
    await this.onPersisted(summary, normalizedInput);
  }

  async reconcile(): Promise<void> {
    const input = this.indeterminateInput;
    if (input === null || this.inFlight || this.completed) return;

    this.inFlight = true;
    this.onStateChange({ status: "reconciling" });

    let response: CancellationResponse;
    try {
      response = await this.reconciliationTransport(input.orderId);
    } catch {
      this.fail(
        "reconcile",
        "No se pudo verificar el estado de la orden. No se enviará otra cancelación hasta verificarlo.",
      );
      return;
    }

    if (response.status === 401 || response.status === 403) {
      this.onAuthorizationBlocked();
      this.fail(
        "blocked",
        "Tu permiso para cancelar órdenes ya no está disponible.",
      );
      return;
    }

    if (response.status === 404) {
      this.fail(
        "blocked",
        "La orden ya no está activa. No se enviará otra cancelación; recarga las órdenes para confirmar el resultado.",
      );
      return;
    }

    if (response.status !== 200) {
      this.fail(
        "reconcile",
        "No se pudo verificar el estado de la orden. No se enviará otra cancelación hasta verificarlo.",
      );
      return;
    }

    let active = false;
    try {
      active = isCancellableActiveOrder(await response.json(), input.orderId);
    } catch {
      active = false;
    }

    if (!active) {
      this.fail(
        "blocked",
        "La orden ya no se puede confirmar como pendiente o lista. No se enviará otra cancelación.",
      );
      return;
    }

    this.inFlight = false;
    this.reloadRequired = false;
    this.indeterminateInput = null;
    this.onStateChange({
      status: "error",
      recovery: "retry",
      message:
        "La orden sigue activa y no fue cancelada. Puedes confirmar nuevamente.",
    });
  }

  private markIndeterminate(
    input: CancellationInput,
    message = "Se perdió la confirmación del servidor. Verifica el estado antes de intentar otra cancelación.",
  ) {
    this.inFlight = false;
    this.reloadRequired = true;
    this.indeterminateInput = input;
    this.onStateChange({ status: "error", recovery: "reconcile", message });
  }

  private fail(
    recovery: "retry" | "reconcile" | "reload" | "blocked",
    message: string,
  ) {
    this.inFlight = false;
    this.onStateChange({ status: "error", recovery, message });
  }
}

export function cancellationFailure(
  status: number,
  code: string | null,
): Extract<CancellationState, { status: "error" }> {
  if (isAuthorizationFailure(status, code)) {
    return {
      status: "error",
      recovery: "blocked",
      message: "No tienes permiso para cancelar esta orden.",
    };
  }
  if (status === 404 || code === "NOT_FOUND") {
    return {
      status: "error",
      recovery: "blocked",
      message: "La orden ya no está disponible.",
    };
  }
  if (code === "ORDER_NOT_CANCELLABLE") {
    return {
      status: "error",
      recovery: "reload",
      message:
        "La orden cambió de estado y ya no puede cancelarse. Recárgala para ver su estado actual.",
    };
  }
  if (status === 422 || code === "INVALID_CANCELLATION") {
    return {
      status: "error",
      recovery: "retry",
      message: "Escribe un motivo válido antes de confirmar la cancelación.",
    };
  }
  return {
    status: "error",
    recovery: "reconcile",
    message:
      "No se pudo determinar si la cancelación se confirmó. Verifica el estado antes de intentar otra cancelación.",
  };
}

function isAuthorizationFailure(status: number, code: string | null) {
  return status === 401 || status === 403 || code === "UNAUTHORIZED";
}

function isCancellableActiveOrder(value: unknown, orderId: string): boolean {
  return (
    isRecord(value) &&
    value.id === orderId &&
    (value.status === "PENDING" || value.status === "READY")
  );
}

function persistedCancellationSummary(
  value: unknown,
  input: CancellationInput,
): CancellationSummary {
  if (
    !isRecord(value) ||
    value.status !== "CANCELLED" ||
    value.orderId !== input.orderId ||
    typeof value.orderNumber !== "string" ||
    typeof value.reason !== "string" ||
    typeof value.cancelledAt !== "string"
  ) {
    throw new Error("invalid cancellation response");
  }

  return Object.freeze({
    orderId: value.orderId,
    orderNumber: value.orderNumber,
    reason: value.reason,
    cancelledAt: value.cancelledAt,
  });
}

function errorCode(value: unknown): string | null {
  return isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === "string"
    ? value.error.code
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
