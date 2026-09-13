// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { operationalTelemetry } from "./recorder";
import { installClientTelemetry } from "./client";

describe("client telemetry", () => {
  it("records browser failures without messages, stacks, or rejection values", () => {
    const record = vi.spyOn(operationalTelemetry, "record");
    installClientTelemetry();

    window.dispatchEvent(
      new ErrorEvent("error", {
        error: Object.assign(new Error("token=secret"), { code: "EAI_AGAIN" }),
        message: "private customer data",
      }),
    );
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", {
      value: new Error("payment details"),
    });
    window.dispatchEvent(rejection);

    expect(record.mock.calls.map(([entry]) => entry)).toEqual([
      {
        event: "exception.unexpected",
        boundary: "client",
        errorClass: "NETWORK",
      },
      {
        event: "exception.unexpected",
        boundary: "client",
        errorClass: "UNKNOWN",
      },
    ]);
    expect(JSON.stringify(record.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(record.mock.calls)).not.toContain("payment details");
  });
});
