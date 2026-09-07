import type { TransactionBoundary } from "../../application";
import type { Result } from "../../domain";

/** The inventory-purchase RPC owns the complete PostgreSQL transaction. */
export class SupabaseInventoryPurchaseRegistrationTransactionBoundary implements TransactionBoundary {
  async run<T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    return work();
  }
}
