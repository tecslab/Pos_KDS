import { describe, expect, it } from "vitest";

import { orderModificationFailure } from "../../application";

import { mapOrderModificationErrorToHttp } from "./order-modification-error-mapping";

function error(code: Parameters<typeof orderModificationFailure>[0]) {
  const result = orderModificationFailure(code);
  return result.ok ? undefined : result.error;
}

describe("mapOrderModificationErrorToHttp", () => {
  it.each([
    [
      "UNAUTHORIZED",
      403,
      "UNAUTHORIZED",
      "You are not authorized to perform this operation.",
    ],
    [
      "INVALID_MODIFICATION",
      422,
      "INVALID_MODIFICATION",
      "The order modification is invalid.",
    ],
    ["NOT_FOUND", 404, "NOT_FOUND", "The order was not found."],
    [
      "ORDER_NOT_PENDING",
      409,
      "ORDER_NOT_PENDING",
      "Only pending orders can be modified.",
    ],
    [
      "STALE_ORDER",
      409,
      "STALE_ORDER",
      "The order has changed since it was loaded.",
    ],
    [
      "STALE_CONFIGURATION",
      409,
      "STALE_CONFIGURATION",
      "The order uses configuration that is no longer available.",
    ],
    [
      "INSUFFICIENT_INVENTORY",
      409,
      "INSUFFICIENT_INVENTORY",
      "There is not enough inventory to complete the requested operation.",
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
      expect(mapOrderModificationErrorToHttp(error(sourceCode))).toEqual({
        status,
        body: { error: { code, message } },
      });
    },
  );

  it.each([
    new Error("database password: secret-value"),
    "secret-value",
    { code: "STALE_ORDER" },
    {
      kind: "order-modification-error",
      code: "STALE_ORDER",
      secret: true,
    },
    { kind: "order-modification-error", code: "UNKNOWN" },
    Object.defineProperty({ kind: "order-modification-error" }, "code", {
      enumerable: true,
      get: () => "STALE_ORDER",
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
    const mapped = mapOrderModificationErrorToHttp(value);

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
    const mapped = mapOrderModificationErrorToHttp(
      error("INVALID_MODIFICATION"),
    );

    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Object.isFrozen(mapped.body)).toBe(true);
    expect(Object.isFrozen(mapped.body.error)).toBe(true);
  });
});
