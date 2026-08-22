import { describe, expect, it } from "vitest";

import { parseServerEnvironment } from "./server-environment";

describe("parseServerEnvironment", () => {
  it("accepts, trims, and freezes a modern Supabase secret key", () => {
    const environment = parseServerEnvironment({
      SUPABASE_SECRET_KEY: "  sb_secret_example-only  ",
    });

    expect(environment).toEqual({
      supabaseSecretKey: "sb_secret_example-only",
    });
    expect(Object.isFrozen(environment)).toBe(true);
  });

  it.each([undefined, "", "anon-key", "service_role"])(
    "rejects an absent or non-secret server credential",
    (SUPABASE_SECRET_KEY) => {
      expect(() => parseServerEnvironment({ SUPABASE_SECRET_KEY })).toThrow(
        "SUPABASE_SECRET_KEY",
      );
    },
  );

  it("does not include a rejected credential in its error", () => {
    const rejected = "not-a-server-secret";

    expect(() =>
      parseServerEnvironment({ SUPABASE_SECRET_KEY: rejected }),
    ).toThrowError(expect.not.objectContaining({ message: rejected }));
  });
});
