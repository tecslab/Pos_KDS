import type {
  InventoryAlertChanged,
  InventoryAlertTransition,
} from "../../domain";
import type { DomainEventRecorder } from "../domain-event-recorder";

export function recordInventoryAlertEvents(
  events: DomainEventRecorder<InventoryAlertChanged>,
  restaurantId: string,
  transitions: readonly InventoryAlertTransition[],
): void {
  for (const transition of transitions) {
    events.record(
      Object.freeze({
        type: "inventory.alert.changed" as const,
        occurredAt: transition.occurredAt,
        payload: Object.freeze({
          restaurantId,
          inventoryAlertId: transition.inventoryAlertId,
          inventoryMovementId: transition.inventoryMovementId,
          inventoryItemId: transition.inventoryItemId,
          status: transition.status,
          threshold: transition.threshold,
          observedBalance: transition.observedBalance,
        }),
      }),
    );
  }
}
