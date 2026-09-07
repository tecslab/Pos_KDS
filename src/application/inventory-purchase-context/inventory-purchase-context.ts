import { err, ok, type Result } from "../../domain";

export type InventoryPurchaseRestaurant = Readonly<{
  id: string;
  name: string;
}>;

export type InventoryPurchaseItem = Readonly<{
  id: string;
  restaurantId: string;
  name: string;
  unitOfMeasure: string;
}>;

export type InventoryPurchaseExpenseCategory = Readonly<{
  id: string;
  restaurantId: string;
  code: string;
  name: string;
}>;

export type InventoryPurchaseContext = Readonly<{
  restaurants: readonly InventoryPurchaseRestaurant[];
  items: readonly InventoryPurchaseItem[];
  expenseCategories: readonly InventoryPurchaseExpenseCategory[];
}>;

export interface InventoryPurchaseContextReader {
  read(): Promise<InventoryPurchaseContext>;
}

export type InventoryPurchaseContextError = Readonly<{
  kind: "inventory-purchase-context-error";
  code: "OPERATION_FAILED";
}>;

export class InventoryPurchaseContextService {
  constructor(private readonly reader: InventoryPurchaseContextReader) {}

  async list(): Promise<
    Result<InventoryPurchaseContext, InventoryPurchaseContextError>
  > {
    try {
      const context = await this.reader.read();
      const restaurantIds = new Set(context.restaurants.map(({ id }) => id));
      if (
        context.items.some((item) => !restaurantIds.has(item.restaurantId)) ||
        context.expenseCategories.some(
          (category) => !restaurantIds.has(category.restaurantId),
        )
      ) {
        return failure();
      }

      return ok(
        Object.freeze({
          restaurants: Object.freeze([...context.restaurants]),
          items: Object.freeze([...context.items]),
          expenseCategories: Object.freeze([...context.expenseCategories]),
        }),
      );
    } catch {
      return failure();
    }
  }
}

function failure(): Result<never, InventoryPurchaseContextError> {
  return err(
    Object.freeze({
      kind: "inventory-purchase-context-error" as const,
      code: "OPERATION_FAILED" as const,
    }),
  );
}
