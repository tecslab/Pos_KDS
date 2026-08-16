import { describe, expect, expectTypeOf, it } from "vitest";

import { err, ok, type Result } from "./result";

describe("Result", () => {
  it("creates an immutable success value", () => {
    const result = ok({ orderId: "order-1" });

    expect(result).toEqual({ ok: true, value: { orderId: "order-1" } });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("creates an immutable failure value", () => {
    const result = err("not-found");

    expect(result).toEqual({ ok: false, error: "not-found" });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("narrows success and failure values using the discriminator", () => {
    const read = (result: Result<number, "failed">): number => {
      if (result.ok) {
        expectTypeOf(result.value).toEqualTypeOf<number>();
        return result.value;
      }

      expectTypeOf(result.error).toEqualTypeOf<"failed">();
      return 0;
    };

    expect(read(ok(7))).toBe(7);
    expect(read(err("failed"))).toBe(0);
  });
});
