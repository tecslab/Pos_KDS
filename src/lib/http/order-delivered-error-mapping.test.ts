import { describe, expect, it } from "vitest";

import { mapOrderDeliveredErrorToHttp } from "./order-delivered-error-mapping";

describe("mapOrderDeliveredErrorToHttp", () => {
  it.each([
    ["UNAUTHORIZED", 403, "UNAUTHORIZED"],
    ["INVALID_DELIVERED_TRANSITION", 422, "INVALID_DELIVERED_TRANSITION"],
    ["NOT_FOUND", 404, "NOT_FOUND"],
    ["ORDER_NOT_ON_THE_WAY", 409, "ORDER_NOT_ON_THE_WAY"],
    ["OPERATION_FAILED", 500, "INTERNAL_ERROR"],
  ] as const)("maps %s to a sanitized response", (code, status, publicCode) => {
    expect(
      mapOrderDeliveredErrorToHttp({
        kind: "order-delivered-error",
        code,
      }),
    ).toMatchObject({ status, body: { error: { code: publicCode } } });
  });

  it.each([
    null,
    { kind: "order-delivered-error", code: "UNKNOWN" },
    {
      kind: "order-delivered-error",
      code: "NOT_FOUND",
      detail: "private",
    },
  ])("fails closed for malformed errors", (error) => {
    expect(mapOrderDeliveredErrorToHttp(error)).toMatchObject({
      status: 500,
      body: { error: { code: "INTERNAL_ERROR" } },
    });
  });
});
