import { describe, expect, it } from "vitest";

import { orderConfirmationFailure } from "../../application";

import { mapOrderConfirmationErrorToHttp } from "./order-confirmation-error-mapping";

function error(code: Parameters<typeof orderConfirmationFailure>[0]) {
  const result = orderConfirmationFailure(code);
  return result.ok ? undefined : result.error;
}

describe("mapOrderConfirmationErrorToHttp", () => {
  it.each([
    [
      "UNAUTHORIZED",
      403,
      "UNAUTHORIZED",
      "You are not authorized to perform this operation.",
    ],
    ["INVALID_DRAFT", 422, "INVALID_DRAFT", "The order draft is invalid."],
    [
      "LOCATION_UNAVAILABLE",
      409,
      "LOCATION_UNAVAILABLE",
      "The service location cannot accept this order.",
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
      expect(mapOrderConfirmationErrorToHttp(error(sourceCode))).toEqual({
        status,
        body: { error: { code, message } },
      });
    },
  );

  it.each([
    new Error("database password: secret-value"),
    "secret-value",
    { code: "INVALID_DRAFT" },
    { kind: "order-confirmation-error", code: "INVALID_DRAFT", secret: true },
    { kind: "order-confirmation-error", code: "UNKNOWN" },
    Object.defineProperty({ kind: "order-confirmation-error" }, "code", {
      enumerable: true,
      get: () => "INVALID_DRAFT",
    }),
    new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("secret-value");
        },
      },
    ),
  ])(
    "fails closed for technical failures and malformed lookalikes",
    (value) => {
      const mapped = mapOrderConfirmationErrorToHttp(value);

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
    },
  );

  it("returns deeply immutable descriptors", () => {
    const mapped = mapOrderConfirmationErrorToHttp(error("INVALID_DRAFT"));

    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Object.isFrozen(mapped.body)).toBe(true);
    expect(Object.isFrozen(mapped.body.error)).toBe(true);
  });
});
