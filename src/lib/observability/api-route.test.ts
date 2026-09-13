import { describe, expect, it, vi } from "vitest";

import { observeApiRoute } from "./api-route";

describe("observeApiRoute", () => {
  it("measures the completed handler and records its actual 4xx status", async () => {
    const record = vi.fn();
    let complete: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const handler = vi.fn((_request: Request) => {
      void _request;
      return pending;
    });
    const observed = observeApiRoute(
      "GET",
      handler,
      { record },
      {
        now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(16),
      },
    );
    const request = new Request(
      "https://carnales.example/api/private?token=secret",
      { headers: { authorization: "Bearer private" } },
    );

    const result = observed(request);
    expect(record).not.toHaveBeenCalled();
    const response = Response.json(
      { error: { code: "NOT_FOUND" } },
      { status: 404 },
    );
    complete?.(response);

    await expect(result).resolves.toBe(response);
    expect(record).toHaveBeenCalledWith({
      event: "request.completed",
      method: "GET",
      outcome: "failure",
      statusCode: 404,
      durationMs: 6,
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain("token");
    expect(JSON.stringify(record.mock.calls)).not.toContain("private");
  });

  it("records an unknown exception for a completed 500 response and preserves it", async () => {
    const record = vi.fn();
    const response = Response.json(
      { existing: "generic response" },
      { status: 500 },
    );
    const observed = observeApiRoute(
      "POST",
      async () => response,
      { record },
      { now: vi.fn().mockReturnValueOnce(2).mockReturnValueOnce(5) },
    );

    await expect(observed()).resolves.toBe(response);
    expect(record.mock.calls.map(([event]) => event)).toEqual([
      {
        event: "exception.unexpected",
        boundary: "request",
        errorClass: "UNKNOWN",
      },
      {
        event: "request.completed",
        method: "POST",
        outcome: "failure",
        statusCode: 500,
        durationMs: 3,
      },
    ]);
  });

  it("contains an escaped exception as a generic 500 with safe classification", async () => {
    const record = vi.fn();
    const observed = observeApiRoute(
      "PATCH",
      async () => {
        throw Object.assign(new Error("customer payment secret"), {
          code: "ETIMEDOUT",
        });
      },
      { record },
      { now: vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(8) },
    );

    const response = await observed();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
    expect(record.mock.calls.map(([event]) => event)).toEqual([
      {
        event: "exception.unexpected",
        boundary: "request",
        errorClass: "TIMEOUT",
      },
      {
        event: "request.completed",
        method: "PATCH",
        outcome: "failure",
        statusCode: 500,
        durationMs: 7,
      },
    ]);
    expect(JSON.stringify(record.mock.calls)).not.toContain("customer");
    expect(JSON.stringify(record.mock.calls)).not.toContain("secret");
  });

  it("preserves successful responses when custom telemetry throws", async () => {
    const response = new Response(null, { status: 204 });
    const observed = observeApiRoute(
      "DELETE",
      async () => response,
      {
        record() {
          throw new Error("telemetry unavailable");
        },
      },
      { now: () => 1 },
    );

    await expect(observed()).resolves.toBe(response);
  });
});
