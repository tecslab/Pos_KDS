import { describe, expect, it, vi } from "vitest";

import {
  SafeOperationalTelemetryRecorder,
  classifyTelemetryError,
  telemetryDuration,
  telemetryNow,
} from "./operational-telemetry";

describe("operational telemetry", () => {
  it("emits only the closed allowlisted shape and removes extra sensitive input", () => {
    const write = vi.fn();
    const recorder = new SafeOperationalTelemetryRecorder({ write });

    recorder.record({
      event: "database.operation",
      operation: "rpc",
      outcome: "failure",
      durationMs: 12.34567,
      errorClass: "DATABASE",
      token: "secret-token",
      url: "https://example.test/private",
      requestBody: { card: "4111111111111111" },
      entityId: "order-1",
    });

    expect(write).toHaveBeenCalledWith({
      schemaVersion: 1,
      event: "database.operation",
      level: "error",
      operation: "rpc",
      outcome: "failure",
      durationMs: 12.346,
      errorClass: "DATABASE",
    });
    expect(JSON.stringify(write.mock.calls[0]?.[0])).not.toContain("secret");
    expect(Object.isFrozen(write.mock.calls[0]?.[0])).toBe(true);
  });

  it("retains safe completed-request status including client errors", () => {
    const write = vi.fn();
    const recorder = new SafeOperationalTelemetryRecorder({ write });

    recorder.record({
      event: "request.completed",
      method: "POST",
      outcome: "failure",
      statusCode: 422,
      durationMs: 4,
      body: { private: true },
    });

    expect(write).toHaveBeenCalledWith({
      schemaVersion: 1,
      event: "request.completed",
      level: "error",
      method: "POST",
      outcome: "failure",
      statusCode: 422,
      durationMs: 4,
    });
  });

  it("ignores invalid and hostile records and isolates sync and async sinks", async () => {
    const hostile = Object.defineProperty({}, "event", {
      get() {
        throw new Error("must not escape");
      },
    });
    const throwing = new SafeOperationalTelemetryRecorder({
      write() {
        throw new Error("sink unavailable");
      },
    });
    const rejecting = new SafeOperationalTelemetryRecorder({
      async write() {
        throw new Error("sink rejected");
      },
    });

    expect(() => throwing.record(hostile)).not.toThrow();
    expect(() =>
      throwing.record({ event: "unknown", password: "private" }),
    ).not.toThrow();
    expect(() =>
      rejecting.record({
        event: "authentication.failed",
        reason: "PROVIDER_FAILURE",
      }),
    ).not.toThrow();
    await Promise.resolve();
  });

  it("classifies only safe codes and names without using messages or stacks", () => {
    expect(classifyTelemetryError({ code: "ETIMEDOUT" })).toBe("TIMEOUT");
    expect(classifyTelemetryError({ name: "AuthError" })).toBe(
      "AUTHENTICATION",
    );
    expect(classifyTelemetryError({ code: "23505" })).toBe("DATABASE");
    expect(classifyTelemetryError({ code: "ECONNRESET" })).toBe("NETWORK");
    expect(
      classifyTelemetryError(
        Object.defineProperty(
          { message: "token=secret", stack: "private stack" },
          "code",
          {
            get() {
              throw new Error("hostile");
            },
          },
        ),
      ),
    ).toBe("UNKNOWN");
    expect(classifyTelemetryError(new Error("database password secret"))).toBe(
      "UNKNOWN",
    );
  });

  it("uses monotonic values safely and clamps clock failures", () => {
    const clock = {
      now: vi.fn().mockReturnValueOnce(10).mockReturnValue(14.5),
    };
    const startedAt = telemetryNow(clock);

    expect(telemetryDuration(clock, startedAt)).toBe(4.5);
    expect(
      telemetryNow({
        now() {
          throw new Error("clock unavailable");
        },
      }),
    ).toBe(0);
  });
});
