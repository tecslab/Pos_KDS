import type { Result } from "../../domain";
import type { TransactionBoundary } from "../../application";

/**
 * The order-modification RPC owns the complete PostgreSQL transaction. Once
 * its callback resolves, all order, audit, and inventory effects have either
 * committed together or have all been rejected.
 */
export class SupabaseOrderModificationTransactionBoundary implements TransactionBoundary {
  async run<T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    return work();
  }
}
