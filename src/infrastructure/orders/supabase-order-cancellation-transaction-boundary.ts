import type { Result } from "../../domain";
import type { TransactionBoundary } from "../../application";

/** The cancellation RPC owns the complete PostgreSQL transaction. */
export class SupabaseOrderCancellationTransactionBoundary implements TransactionBoundary {
  async run<T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    return work();
  }
}
