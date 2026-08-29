import type { DomainEvent } from "./domain-event";

export type InventoryReconciledMovement = Readonly<{
  inventoryMovementId: string;
  inventoryItemId: string;
  type: "SALE" | "ROLLBACK";
  quantityDelta: string;
  unitOfMeasure: string;
  reversedMovementId: string | null;
}>;

export type InventoryReconciledPayload = Readonly<{
  orderId: string;
  restaurantId: string;
  movements: readonly InventoryReconciledMovement[];
}>;

export type InventoryReconciled = DomainEvent<
  "inventory.reconciled",
  InventoryReconciledPayload
>;
