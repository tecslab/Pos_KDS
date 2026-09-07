import type { DomainEvent } from "./domain-event";

export type InventoryPurchaseRegisteredLine = Readonly<{
  inventoryItemId: string;
  inventoryMovementId: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  lineTotal: string;
}>;

export type InventoryPurchaseRegisteredPayload = Readonly<{
  purchaseId: string;
  restaurantId: string;
  operatingExpenseId: string;
  totalAmount: string;
  recordedAt: string;
  lines: readonly InventoryPurchaseRegisteredLine[];
}>;

export type InventoryPurchaseRegistered = DomainEvent<
  "inventory.purchase.registered",
  InventoryPurchaseRegisteredPayload
>;
