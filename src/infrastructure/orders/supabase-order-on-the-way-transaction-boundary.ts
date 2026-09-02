import type { TransactionBoundary } from "../../application";
import type { Result } from "../../domain";

/** The mark-On-the-Way RPC owns the complete PostgreSQL transaction. */
export class SupabaseOrderOnTheWayTransactionBoundary implements TransactionBoundary {
  async run<T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    return work();
  }
}
