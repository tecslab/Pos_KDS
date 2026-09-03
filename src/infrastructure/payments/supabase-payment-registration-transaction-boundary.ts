import type { TransactionBoundary } from "../../application";
import type { Result } from "../../domain";

/** The register-payment RPC owns the complete PostgreSQL transaction. */
export class SupabasePaymentRegistrationTransactionBoundary implements TransactionBoundary {
  async run<T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    return work();
  }
}
