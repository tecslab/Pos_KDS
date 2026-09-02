import { describe, expect, it } from "vitest";

import { mapOrderOnTheWayErrorToHttp } from "./order-on-the-way-error-mapping";

describe("mapOrderOnTheWayErrorToHttp", () => {
  it.each([
    ["UNAUTHORIZED", 403, "UNAUTHORIZED"],
    ["INVALID_ON_THE_WAY_TRANSITION", 422, "INVALID_ON_THE_WAY_TRANSITION"],
    ["NOT_FOUND", 404, "NOT_FOUND"],
    ["ORDER_NOT_READY", 409, "ORDER_NOT_READY"],
    ["OPERATION_FAILED", 500, "INTERNAL_ERROR"],
  ] as const)("maps %s to a sanitized response", (code, status, publicCode) => {
    expect(
      mapOrderOnTheWayErrorToHttp({
        kind: "order-on-the-way-error",
        code,
      }),
    ).toMatchObject({ status, body: { error: { code: publicCode } } });
  });

  it.each([
    null,
    { kind: "order-on-the-way-error", code: "UNKNOWN" },
    {
      kind: "order-on-the-way-error",
      code: "NOT_FOUND",
      detail: "private",
    },
  ])("fails closed for malformed errors", (error) => {
    expect(mapOrderOnTheWayErrorToHttp(error)).toMatchObject({
      status: 500,
      body: { error: { code: "INTERNAL_ERROR" } },
    });
  });
});
