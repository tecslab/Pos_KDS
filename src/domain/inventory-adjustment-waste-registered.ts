import type { DomainEvent } from "./domain-event";

export type InventoryAdjustmentWasteRegisteredPayload = Readonly<{
  originId: string;
  inventoryMovementId: string;
  restaurantId: string;
  inventoryItemId: string;
  quantityDelta: string;
  unitOfMeasure: string;
  recordedAt: string;
  previousBalance: string;
  newBalance: string;
}>;

export type InventoryAdjustmentRegistered = DomainEvent<
  "inventory.adjustment.registered",
  InventoryAdjustmentWasteRegisteredPayload
>;

export type InventoryWasteRegistered = DomainEvent<
  "inventory.waste.registered",
  InventoryAdjustmentWasteRegisteredPayload
>;

export type InventoryAdjustmentWasteRegistered =
  InventoryAdjustmentRegistered | InventoryWasteRegistered;
