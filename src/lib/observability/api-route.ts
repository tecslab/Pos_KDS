import {
  classifyTelemetryError,
  telemetryDuration,
  telemetryNow,
  type MonotonicClock,
  type OperationalTelemetryRecorder,
} from "../../application/observability";

import { operationalTelemetry, operationalTelemetryClock } from "./recorder";

type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ApiRouteHandler<Arguments extends readonly unknown[]> = (
  ...args: Arguments
) => Response | Promise<Response>;

/** Measures the completed API handler, including its actual response status. */
export function observeApiRoute<Arguments extends readonly unknown[]>(
  method: ApiMethod,
  handler: ApiRouteHandler<Arguments>,
  telemetry: OperationalTelemetryRecorder = operationalTelemetry,
  clock: MonotonicClock = operationalTelemetryClock,
): (...args: Arguments) => Promise<Response> {
  return async (...args: Arguments) => {
    const startedAt = telemetryNow(clock);

    try {
      const response = await handler(...args);
      if (response.status >= 500) {
        safelyRecord(telemetry, {
          event: "exception.unexpected",
          boundary: "request",
          errorClass: "UNKNOWN",
        });
      }
      recordCompletion(method, response, telemetry, clock, startedAt);
      return response;
    } catch (error) {
      safelyRecord(telemetry, {
        event: "exception.unexpected",
        boundary: "request",
        errorClass: classifyTelemetryError(error),
      });
      const response = Response.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred.",
          },
        },
        {
          status: 500,
          headers: { "Cache-Control": "no-store" },
        },
      );
      recordCompletion(method, response, telemetry, clock, startedAt);
      return response;
    }
  };
}

function recordCompletion(
  method: ApiMethod,
  response: Response,
  telemetry: OperationalTelemetryRecorder,
  clock: MonotonicClock,
  startedAt: number,
): void {
  safelyRecord(telemetry, {
    event: "request.completed",
    method,
    outcome:
      response.status >= 400
        ? "failure"
        : response.status >= 300
          ? "redirect"
          : "success",
    statusCode: response.status,
    durationMs: telemetryDuration(clock, startedAt),
  });
}

function safelyRecord(
  telemetry: OperationalTelemetryRecorder,
  event: unknown,
): void {
  try {
    telemetry.record(event);
  } catch {
    // Telemetry cannot affect the route response.
  }
}
