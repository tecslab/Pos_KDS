import { err, ok, type Result } from "../../domain";

export type InventoryBalanceView = Readonly<{
  restaurantId: string;
  restaurantName: string;
  inventoryItemId: string;
  inventoryItemName: string;
  inventoryItemType: string;
  unitOfMeasure: string;
  minimumStockLevel: string;
  currentBalance: string;
  isBelowMinimum: boolean;
}>;

export type InventoryMovementView = Readonly<{
  id: string;
  restaurantId: string;
  restaurantName: string;
  inventoryItemId: string;
  inventoryItemName: string;
  type: string;
  quantityDelta: string;
  unitOfMeasure: string;
  recordedBy: Readonly<{ id: string; displayName: string }>;
  recordedAt: string;
  businessOrigin: Readonly<{ type: string; id: string }>;
  comments: string | null;
  reversedMovementId: string | null;
}>;

export type InventoryLowStockAlertView = Readonly<{
  id: string;
  restaurantId: string;
  restaurantName: string;
  inventoryItemId: string;
  inventoryItemName: string;
  unitOfMeasure: string;
  threshold: string;
  observedBalance: string;
  openedAt: string;
}>;

export type InventoryViews = Readonly<{
  balances: readonly InventoryBalanceView[];
  movements: readonly InventoryMovementView[];
  activeAlerts: readonly InventoryLowStockAlertView[];
}>;

export interface InventoryViewsReader {
  read(): Promise<InventoryViews>;
}

export type InventoryViewsError = Readonly<{
  kind: "inventory-views-error";
  code: "OPERATION_FAILED";
}>;

export class InventoryViewsService {
  constructor(private readonly reader: InventoryViewsReader) {}

  async list(): Promise<Result<InventoryViews, InventoryViewsError>> {
    try {
      const views = await this.reader.read();
      if (!isValidViews(views)) return failure();
      return ok(views);
    } catch {
      return failure();
    }
  }
}

function isValidViews(value: InventoryViews) {
  return (
    Array.isArray(value.balances) &&
    Array.isArray(value.movements) &&
    Array.isArray(value.activeAlerts)
  );
}

function failure() {
  return err(
    Object.freeze({
      kind: "inventory-views-error" as const,
      code: "OPERATION_FAILED" as const,
    }),
  );
}
