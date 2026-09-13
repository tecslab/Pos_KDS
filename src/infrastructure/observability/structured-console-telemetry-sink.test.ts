import { describe, expect, it, vi } from "vitest";

import { StructuredConsoleTelemetrySink } from "./structured-console-telemetry-sink";

describe("StructuredConsoleTelemetrySink", () => {
  it.each([
    [
      "info",
      "info",
      {
        schemaVersion: 1,
        event: "request.completed",
        level: "info",
        method: "GET",
        outcome: "success",
        statusCode: 200,
        durationMs: 3,
      },
    ],
    [
      "warning",
      "warn",
      {
        schemaVersion: 1,
        event: "authentication.failed",
        level: "warning",
        reason: "PROVIDER_FAILURE",
      },
    ],
    [
      "error",
      "error",
      {
        schemaVersion: 1,
        event: "exception.unexpected",
        level: "error",
        boundary: "request",
        errorClass: "UNKNOWN",
      },
    ],
  ] as const)(
    "routes %s records as one JSON object",
    (_level, method, record) => {
      const output = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const sink = new StructuredConsoleTelemetrySink(output);

      sink.write(record);

      expect(output[method]).toHaveBeenCalledWith(JSON.stringify(record));
      expect(
        output.info.mock.calls.length +
          output.warn.mock.calls.length +
          output.error.mock.calls.length,
      ).toBe(1);
    },
  );
});
