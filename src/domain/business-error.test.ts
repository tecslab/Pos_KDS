import { describe, expect, it } from "vitest";

import {
  insufficientInventoryError,
  invalidPaymentError,
  invalidTransitionError,
  isBusinessError,
  unauthorizedError,
} from "./business-error";

describe("business errors", () => {
  const cases = [
    [invalidTransitionError, "INVALID_TRANSITION"],
    [insufficientInventoryError, "INSUFFICIENT_INVENTORY"],
    [invalidPaymentError, "INVALID_PAYMENT"],
    [unauthorizedError, "UNAUTHORIZED"],
  ] as const;

  it.each(cases)("creates and recognizes %s", (factory, code) => {
    const error = factory();

    expect(error).toEqual({ kind: "business-error", code });
    expect(Object.isFrozen(error)).toBe(true);
    expect(isBusinessError(error)).toBe(true);
  });

  it.each([
    null,
    new Error("database unavailable"),
    { code: "INVALID_TRANSITION" },
    { kind: "business-error", code: "NOT_A_BUSINESS_ERROR" },
    {
      kind: "business-error",
      code: "INVALID_PAYMENT",
      leakedDetail: "unexpected field",
    },
  ])("rejects a non-business-error value", (value) => {
    expect(isBusinessError(value)).toBe(false);
  });
});
