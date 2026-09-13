import {
  classifyTelemetryError,
  telemetryDuration,
  telemetryNow,
  type MonotonicClock,
  type OperationalTelemetryRecorder,
} from "../../application";

type DatabaseOperation = "query" | "rpc";

type OperationState = {
  recorded: boolean;
  readonly startedAt: number;
};

/**
 * Instruments only Supabase's database entry points. Arguments, relation/RPC
 * names, query values, rows, and errors never enter telemetry.
 */
export function instrumentSupabaseDatabaseClient<Client extends object>(
  client: Client,
  recorder: OperationalTelemetryRecorder,
  clock: MonotonicClock,
): Client {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);

      if (
        (property !== "from" && property !== "rpc") ||
        typeof value !== "function"
      ) {
        return typeof value === "function" ? value.bind(target) : value;
      }

      const operation: DatabaseOperation = property === "rpc" ? "rpc" : "query";
      return (...args: unknown[]) => {
        const state: OperationState = {
          recorded: false,
          startedAt: telemetryNow(clock),
        };

        try {
          return wrapDatabaseBuilder(
            Reflect.apply(value, target, args),
            operation,
            state,
            recorder,
            clock,
          );
        } catch (error) {
          recordFailure(operation, error, state, recorder, clock);
          throw error;
        }
      };
    },
  });
}

function wrapDatabaseBuilder(
  builder: unknown,
  operation: DatabaseOperation,
  state: OperationState,
  recorder: OperationalTelemetryRecorder,
  clock: MonotonicClock,
): unknown {
  if (!isObjectLike(builder)) return builder;

  return new Proxy(builder, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);

      if (property === "then" && typeof value === "function") {
        return (
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) =>
          Reflect.apply(value, target, [
            (response: unknown) => {
              recordResponse(operation, response, state, recorder, clock);
              return onFulfilled === undefined
                ? response
                : onFulfilled(response);
            },
            (error: unknown) => {
              recordFailure(operation, error, state, recorder, clock);
              if (onRejected !== undefined) return onRejected(error);
              throw error;
            },
          ]);
      }

      if (typeof value !== "function") return value;

      return (...args: unknown[]) => {
        try {
          return wrapDatabaseBuilder(
            Reflect.apply(value, target, args),
            operation,
            state,
            recorder,
            clock,
          );
        } catch (error) {
          recordFailure(operation, error, state, recorder, clock);
          throw error;
        }
      };
    },
  });
}

function recordResponse(
  operation: DatabaseOperation,
  response: unknown,
  state: OperationState,
  recorder: OperationalTelemetryRecorder,
  clock: MonotonicClock,
): void {
  let error: unknown = null;
  try {
    if (typeof response === "object" && response !== null) {
      error = (response as Record<string, unknown>).error;
    }
  } catch {
    error = Object.freeze({});
  }

  if (error === null || error === undefined) {
    recordOnce(operation, "success", undefined, state, recorder, clock);
  } else {
    recordOnce(
      operation,
      "failure",
      classifyTelemetryError(error),
      state,
      recorder,
      clock,
    );
  }
}

function recordFailure(
  operation: DatabaseOperation,
  error: unknown,
  state: OperationState,
  recorder: OperationalTelemetryRecorder,
  clock: MonotonicClock,
): void {
  recordOnce(
    operation,
    "failure",
    classifyTelemetryError(error),
    state,
    recorder,
    clock,
  );
}

function recordOnce(
  operation: DatabaseOperation,
  outcome: "success" | "failure",
  errorClass: ReturnType<typeof classifyTelemetryError> | undefined,
  state: OperationState,
  recorder: OperationalTelemetryRecorder,
  clock: MonotonicClock,
): void {
  if (state.recorded) return;
  state.recorded = true;
  try {
    recorder.record({
      event: "database.operation",
      operation,
      outcome,
      durationMs: telemetryDuration(clock, state.startedAt),
      ...(errorClass === undefined ? {} : { errorClass }),
    });
  } catch {
    // Custom telemetry implementations cannot affect database operations.
  }
}

function isObjectLike(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}
