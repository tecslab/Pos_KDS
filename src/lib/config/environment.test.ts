import { describe, expect, expectTypeOf, it } from "vitest";

import {
  EnvironmentConfigurationError,
  parsePublicEnvironment,
  type PublicEnvironment,
} from "./environment";

const validSource = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example-key",
};

describe("parsePublicEnvironment", () => {
  it("returns a normalized, immutable, typed public configuration", () => {
    const environment = parsePublicEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: `  ${validSource.NEXT_PUBLIC_SUPABASE_URL}  `,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `  ${validSource.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}  `,
    });

    expect(environment).toEqual({
      supabaseUrl: validSource.NEXT_PUBLIC_SUPABASE_URL,
      supabasePublishableKey: validSource.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    expect(Object.isFrozen(environment)).toBe(true);
    expectTypeOf(environment).toEqualTypeOf<PublicEnvironment>();
  });

  it("returns only allowlisted public fields", () => {
    const sourceWithUnrelatedValue = {
      ...validSource,
      UNRELATED_VALUE: "must-not-be-exposed",
    };

    const environment = parsePublicEnvironment(sourceWithUnrelatedValue);

    expect(Object.keys(environment)).toEqual([
      "supabaseUrl",
      "supabasePublishableKey",
    ]);
    expect(JSON.stringify(environment)).not.toContain("must-not-be-exposed");
  });

  it.each([
    [
      "missing URL",
      {
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          validSource.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      },
      "NEXT_PUBLIC_SUPABASE_URL is required and must not be blank",
    ],
    [
      "blank publishable key",
      {
        NEXT_PUBLIC_SUPABASE_URL: validSource.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "  ",
      },
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required and must not be blank",
    ],
    [
      "non-HTTP URL",
      {
        ...validSource,
        NEXT_PUBLIC_SUPABASE_URL: "postgresql://private-host/database",
      },
      "NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP(S) URL",
    ],
    [
      "legacy-shaped key",
      {
        ...validSource,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "legacy.private-value",
      },
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a modern Supabase publishable key",
    ],
    [
      "empty publishable-key payload",
      {
        ...validSource,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_",
      },
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a modern Supabase publishable key",
    ],
  ])("rejects %s without echoing its value", (_case, source, expectedIssue) => {
    expect(() => parsePublicEnvironment(source)).toThrow(
      EnvironmentConfigurationError,
    );

    try {
      parsePublicEnvironment(source);
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentConfigurationError);
      expect((error as Error).message).toContain(expectedIssue);
      expect((error as Error).message).not.toContain("private-value");
      expect((error as Error).message).not.toContain("private-host");
    }
  });

  it("reports all invalid public fields together", () => {
    expect(() => parsePublicEnvironment({})).toThrowError(
      new EnvironmentConfigurationError([
        "NEXT_PUBLIC_SUPABASE_URL is required and must not be blank",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required and must not be blank",
      ]),
    );
  });
});
