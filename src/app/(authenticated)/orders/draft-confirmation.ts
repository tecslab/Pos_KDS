import type { ConfirmOrderInput } from "@/application";

import type { DraftState } from "./draft-state";

export type ConfirmationState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "pending" }>
  | Readonly<{ status: "success"; orderNumber: string | null }>
  | Readonly<{ status: "error"; message: string }>;

export type ConfirmationResponse = Readonly<{
  status: number;
  json(): Promise<unknown>;
}>;

export type ConfirmationTransport = (
  input: ConfirmOrderInput,
) => Promise<ConfirmationResponse>;

export type ConfirmationActionState = Readonly<{
  disabled: boolean;
  label: string;
}>;

export class DraftConfirmationWorkflow {
  private inFlight = false;

  constructor(
    private readonly transport: ConfirmationTransport,
    private readonly onStateChange: (state: ConfirmationState) => void,
    private readonly onPersisted: (orderNumber: string | null) => void,
  ) {}

  async submit(input: ConfirmOrderInput | null): Promise<void> {
    if (this.inFlight || input === null) return;

    this.inFlight = true;
    this.onStateChange({ status: "pending" });

    let response: ConfirmationResponse;
    try {
      response = await this.transport(input);
    } catch {
      this.fail(
        "No se pudo conectar para confirmar la orden. El borrador sigue disponible para reintentar.",
      );
      return;
    }

    if (response.status !== 201) {
      this.fail(confirmationFailureMessage(response.status));
      return;
    }

    let orderNumber: string | null = null;
    try {
      orderNumber = confirmedOrderNumber(await response.json());
    } catch {
      // A 201 has already persisted the order; avoid offering a duplicate retry.
    }

    this.inFlight = false;
    this.onPersisted(orderNumber);
    this.onStateChange({ status: "success", orderNumber });
  }

  private fail(message: string) {
    this.inFlight = false;
    this.onStateChange({ status: "error", message });
  }
}

export function confirmationActionState(
  state: ConfirmationState,
  input: ConfirmOrderInput | null,
): ConfirmationActionState {
  const pending = state.status === "pending";
  return Object.freeze({
    disabled: input === null || pending,
    label: pending ? "Confirmando orden…" : "Confirmar orden",
  });
}

/**
 * Maps the private, display-oriented draft to the public confirmation input.
 * Prices, names, and printer routing remain client display data; the server
 * resolves the effective configuration when it persists the order.
 */
export function toConfirmationInput(
  draft: DraftState,
): ConfirmOrderInput | null {
  if (draft.locationId === null || draft.lines.length === 0) return null;

  const baskets = draft.baskets.flatMap((basket) => {
    const lines = draft.lines
      .filter((line) => line.basketId === basket.id)
      .map((line) =>
        Object.freeze({
          clientCorrelationId: line.id,
          productVersionId: line.productVersionId,
          quantity: line.quantity,
          optionIds: Object.freeze(line.options.map((option) => option.id)),
          removableIngredientIds: Object.freeze(
            line.removableIngredients.map((ingredient) => ingredient.id),
          ),
          observations: line.observation || null,
        }),
      );

    return lines.length > 0
      ? [
          Object.freeze({
            clientCorrelationId: basket.id,
            lines: Object.freeze(lines),
          }),
        ]
      : [];
  });

  return baskets.length > 0
    ? Object.freeze({
        serviceLocationId: draft.locationId,
        baskets: Object.freeze(baskets),
      })
    : null;
}

export function confirmationFailureMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "No tienes permiso para confirmar esta orden.";
  }

  if (status === 409) {
    return "La ubicación o el menú cambió. Revisa la orden e inténtalo de nuevo.";
  }

  if (status === 422) {
    return "La orden necesita una ubicación y al menos un producto válido.";
  }

  return "No se pudo confirmar la orden. Revisa el borrador e inténtalo de nuevo.";
}

export function confirmedOrderNumber(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "orderNumber" in value &&
    typeof value.orderNumber === "string" &&
    value.orderNumber.trim().length > 0
  ) {
    return value.orderNumber;
  }

  return null;
}
