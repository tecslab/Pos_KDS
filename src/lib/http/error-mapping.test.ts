import { describe, expect, it } from "vitest";

import {
  insufficientInventoryError,
  invalidPaymentError,
  invalidTransitionError,
  unauthorizedError,
} from "../../domain";

import { mapErrorToHttp } from "./error-mapping";

describe("mapErrorToHttp", () => {
  it.each([
    [
      invalidTransitionError(),
      409,
      "INVALID_TRANSITION",
      "The requested operation is not valid in the current state.",
    ],
    [
      insufficientInventoryError(),
      409,
      "INSUFFICIENT_INVENTORY",
      "There is not enough inventory to complete the requested operation.",
    ],
    [
      invalidPaymentError(),
      422,
      "INVALID_PAYMENT",
      "The payment amount is invalid.",
    ],
    [
      unauthorizedError(),
      403,
      "UNAUTHORIZED",
      "You are not authorized to perform this operation.",
    ],
  ] as const)(
    "maps %s to a safe HTTP descriptor",
    (error, status, code, message) => {
      expect(mapErrorToHttp(error)).toEqual({
        status,
        body: { error: { code, message } },
      });
    },
  );

  it.each([
    new Error("database password: secret-value"),
    "network timeout with secret-value",
    { kind: "business-error", code: "UNKNOWN", detail: "secret-value" },
    { code: "INVALID_TRANSITION", detail: "secret-value" },
  ])(
    "maps technical failures and malformed lookalikes to a safe 500",
    (error) => {
      const mapped = mapErrorToHttp(error);

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
    const mapped = mapErrorToHttp(invalidPaymentError());

    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Object.isFrozen(mapped.body)).toBe(true);
    expect(Object.isFrozen(mapped.body.error)).toBe(true);
  });
});
