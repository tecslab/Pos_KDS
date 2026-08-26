import type { Result } from "../../domain";
import type { TransactionBoundary } from "../../application";

/**
 * The order-confirmation RPC is itself the complete PostgreSQL transaction.
 * Resolving its callback therefore means that RPC has committed or rejected as
 * one unit; this boundary deliberately performs no second persistence call.
 */
export class SupabaseOrderConfirmationTransactionBoundary implements TransactionBoundary {
  async run<T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    return work();
  }
}
