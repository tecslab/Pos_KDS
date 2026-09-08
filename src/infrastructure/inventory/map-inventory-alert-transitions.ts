import type { InventoryAlertTransition } from "../../domain";

const MAX_TRANSITIONS = 1_000;

export function mapInventoryAlertTransitions(
  value: unknown,
): readonly InventoryAlertTransition[] | null {
  if (!Array.isArray(value) || value.length > MAX_TRANSITIONS) return null;

  const alertStates = new Set<string>();
  const movementIds = new Set<string>();
  const transitions: InventoryAlertTransition[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      Reflect.ownKeys(candidate).length !== 7 ||
      !isUuid(candidate.inventory_alert_id) ||
      !isUuid(candidate.inventory_movement_id) ||
      movementIds.has(candidate.inventory_movement_id) ||
      !isUuid(candidate.inventory_item_id) ||
      (candidate.status !== "ACTIVE" && candidate.status !== "RESOLVED")
    ) {
      return null;
    }

    const threshold = decimal(candidate.threshold, false);
    const observedBalance = decimal(candidate.observed_balance, true);
    const occurredAt = timestamp(candidate.occurred_at);
    const alertState = `${candidate.inventory_alert_id}:${candidate.status}`;
    if (
      threshold === null ||
      observedBalance === null ||
      occurredAt === null ||
      alertStates.has(alertState) ||
      (candidate.status === "ACTIVE" &&
        Number(observedBalance) >= Number(threshold)) ||
      (candidate.status === "RESOLVED" &&
        Number(observedBalance) < Number(threshold))
    ) {
      return null;
    }

    movementIds.add(candidate.inventory_movement_id);
    alertStates.add(alertState);
    transitions.push(
      Object.freeze({
        inventoryAlertId: candidate.inventory_alert_id,
        inventoryMovementId: candidate.inventory_movement_id,
        inventoryItemId: candidate.inventory_item_id,
        status: candidate.status,
        threshold,
        observedBalance,
        occurredAt,
      }),
    );
  }

  return Object.freeze(transitions);
}

function decimal(value: unknown, signed: boolean): string | null {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !new RegExp(signed ? "^-?\\d+(?:\\.\\d+)?$" : "^\\d+(?:\\.\\d+)?$").test(
      String(value),
    )
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
