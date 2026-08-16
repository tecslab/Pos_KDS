import type { Result } from "../domain";

/**
 * Runs a business operation atomically.
 *
 * Implementations commit only an Ok result. They roll back an Err result, and
 * roll back then rethrow an unexpected rejection.
 */
export interface TransactionBoundary {
  run<T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>>;
}
