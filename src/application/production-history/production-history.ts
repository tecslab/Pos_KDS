import { err, ok, type Result } from "../../domain";

/** Immutable, completed production records rendered by the production workspace. */
export type ProductionBatchHistoryEntry = Readonly<{
  batchId: string;
  restaurantId: string;
  restaurantName: string;
  productId: string;
  productName: string;
  recipeName: string;
  recipeVersionId: string;
  recipeVersionNumber: number;
  producedQuantity: string;
  unitOfMeasure: string;
  completedBy: Readonly<{ id: string; displayName: string }>;
  completedAt: string;
  notes: string | null;
}>;

export interface ProductionHistoryReader {
  read(): Promise<readonly ProductionBatchHistoryEntry[]>;
}

export type ProductionHistoryError = Readonly<{
  kind: "production-history-error";
  code: "OPERATION_FAILED";
}>;

export class ProductionHistoryService {
  constructor(private readonly reader: ProductionHistoryReader) {}

  async list(): Promise<
    Result<readonly ProductionBatchHistoryEntry[], ProductionHistoryError>
  > {
    try {
      const entries = await this.reader.read();
      if (!Array.isArray(entries)) return failure();
      return ok(Object.freeze([...entries]));
    } catch {
      return failure();
    }
  }
}

function failure() {
  return err(
    Object.freeze({
      kind: "production-history-error" as const,
      code: "OPERATION_FAILED" as const,
    }),
  );
}
