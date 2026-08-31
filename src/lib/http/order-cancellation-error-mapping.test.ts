import { describe, expect, it } from "vitest";

import { orderCancellationFailure } from "../../application";

import { mapOrderCancellationErrorToHttp } from "./order-cancellation-error-mapping";

function error(code: Parameters<typeof orderCancellationFailure>[0]) {
  const result = orderCancellationFailure(code);
  return result.ok ? undefined : result.error;
}

describe("mapOrderCancellationErrorToHttp", () => {
  it.each([
    [
      "UNAUTHORIZED",
      403,
      "UNAUTHORIZED",
      "You are not authorized to perform this operation.",
    ],
    [
      "INVALID_CANCELLATION",
      422,
      "INVALID_CANCELLATION",
      "The order cancellation is invalid.",
    ],
    ["NOT_FOUND", 404, "NOT_FOUND", "The order was not found."],
    [
      "ORDER_NOT_CANCELLABLE",
      409,
      "ORDER_NOT_CANCELLABLE",
      "Only pending or ready orders can be cancelled.",
    ],
    [
      "OPERATION_FAILED",
      500,
      "INTERNAL_ERROR",
      "An unexpected error occurred.",
    ],
  ] as const)(
    "maps %s to its safe response contract",
    (sourceCode, status, code, message) => {
      expect(mapOrderCancellationErrorToHttp(error(sourceCode))).toEqual({
        status,
        body: { error: { code, message } },
      });
    },
  );

  it.each([
    new Error("database password: secret-value"),
    "secret-value",
    { code: "ORDER_NOT_CANCELLABLE" },
    {
      kind: "order-cancellation-error",
      code: "ORDER_NOT_CANCELLABLE",
      secret: true,
    },
    { kind: "order-cancellation-error", code: "UNKNOWN" },
    Object.defineProperty({ kind: "order-cancellation-error" }, "code", {
      enumerable: true,
      get: () => "ORDER_NOT_CANCELLABLE",
    }),
    new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("secret-value");
        },
      },
    ),
  ])("fails closed for malformed or technical failures", (value) => {
    const mapped = mapOrderCancellationErrorToHttp(value);

    expect(mapped).toEqual({
      status: 500,
      body: {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        },
      },
    });
    expect(JSON.stringify(mapped)).not.toContain("secret-value");
  });

  it("returns deeply immutable descriptors", () => {
    const mapped = mapOrderCancellationErrorToHttp(
      error("INVALID_CANCELLATION"),
    );

    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Object.isFrozen(mapped.body)).toBe(true);
    expect(Object.isFrozen(mapped.body.error)).toBe(true);
  });
});
