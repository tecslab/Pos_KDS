import type { DomainEvent } from "./domain-event";

export type InventoryAlertStatus = "ACTIVE" | "RESOLVED";

export type InventoryAlertTransition = Readonly<{
  inventoryAlertId: string;
  inventoryMovementId: string;
  inventoryItemId: string;
  status: InventoryAlertStatus;
  threshold: string;
  observedBalance: string;
  occurredAt: string;
}>;

export type InventoryAlertChangedPayload = Readonly<{
  restaurantId: string;
  inventoryAlertId: string;
  inventoryMovementId: string;
  inventoryItemId: string;
  status: InventoryAlertStatus;
  threshold: string;
  observedBalance: string;
}>;

export type InventoryAlertChanged = DomainEvent<
  "inventory.alert.changed",
  InventoryAlertChangedPayload
>;
