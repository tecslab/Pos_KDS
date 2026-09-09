import type { DomainEvent } from "./domain-event";

export type ProductionCompletedIngredient = Readonly<{
  inventoryItemId: string;
  inventoryMovementId: string;
  quantityConsumed: string;
  unitOfMeasure: string;
  previousBalance: string;
  newBalance: string;
}>;

export type ProductionCompletedOutput = Readonly<{
  inventoryItemId: string;
  inventoryMovementId: string;
  quantityProduced: string;
  unitOfMeasure: string;
  previousBalance: string;
  newBalance: string;
}>;

export type ProductionCompletedPayload = Readonly<{
  batchId: string;
  restaurantId: string;
  recipeVersionId: string;
  producedQuantity: string;
  unitOfMeasure: string;
  completedAt: string;
  ingredients: readonly ProductionCompletedIngredient[];
  output: ProductionCompletedOutput;
}>;

export type ProductionCompleted = DomainEvent<
  "production.completed",
  ProductionCompletedPayload
>;
