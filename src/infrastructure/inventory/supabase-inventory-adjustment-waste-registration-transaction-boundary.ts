import type { TransactionBoundary } from "../../application";
import type { Result } from "../../domain";

/** The adjustment/waste RPC owns the complete PostgreSQL transaction. */
export class SupabaseInventoryAdjustmentWasteRegistrationTransactionBoundary implements TransactionBoundary {
  async run<T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    return work();
  }
}
