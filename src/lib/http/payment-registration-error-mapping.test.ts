import { describe, expect, it } from "vitest";

import { paymentRegistrationFailure } from "../../application";
import { mapPaymentRegistrationErrorToHttp } from "./payment-registration-error-mapping";

function error(code: Parameters<typeof paymentRegistrationFailure>[0]) {
  const result = paymentRegistrationFailure(code);
  return result.ok ? undefined : result.error;
}

describe("mapPaymentRegistrationErrorToHttp", () => {
  it.each([
    ["UNAUTHORIZED", 403, "UNAUTHORIZED"],
    ["INVALID_PAYMENT", 422, "INVALID_PAYMENT"],
    ["NOT_FOUND", 404, "NOT_FOUND"],
    ["ORDER_NOT_DELIVERED", 409, "ORDER_NOT_DELIVERED"],
    ["BASKET_ALREADY_PAID", 409, "BASKET_ALREADY_PAID"],
    ["PAYMENT_METHOD_UNAVAILABLE", 409, "PAYMENT_METHOD_UNAVAILABLE"],
    ["OVERAGE_NOT_AUTHORIZED", 403, "OVERAGE_NOT_AUTHORIZED"],
    ["OVERAGE_REASON_REQUIRED", 422, "OVERAGE_REASON_REQUIRED"],
    ["OPERATION_FAILED", 500, "INTERNAL_ERROR"],
  ] as const)("maps %s to its safe public contract", (source, status, code) => {
    expect(mapPaymentRegistrationErrorToHttp(error(source))).toMatchObject({
      status,
      body: { error: { code } },
    });
  });

  it.each([
    new Error("database password: secret"),
    {
      kind: "payment-registration-error",
      code: "INVALID_PAYMENT",
      secret: true,
    },
    { kind: "payment-registration-error", code: "UNKNOWN" },
    "secret",
  ])("fails closed for malformed or technical errors", (value) => {
    const mapped = mapPaymentRegistrationErrorToHttp(value);

    expect(mapped).toEqual({
      status: 500,
      body: {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        },
      },
    });
    expect(JSON.stringify(mapped)).not.toContain("secret");
  });

  it("returns deeply immutable descriptors", () => {
    const mapped = mapPaymentRegistrationErrorToHttp(error("INVALID_PAYMENT"));
    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Object.isFrozen(mapped.body)).toBe(true);
    expect(Object.isFrozen(mapped.body.error)).toBe(true);
  });
});
