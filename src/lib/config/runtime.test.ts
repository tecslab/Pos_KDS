import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("publicEnvironment", () => {
  it("reads and exposes only the approved browser variables", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_runtime-check",
    );
    vi.stubEnv("UNRELATED_VALUE", "must-not-be-exposed");

    const { publicEnvironment } = await import("./runtime");

    expect(publicEnvironment).toEqual({
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "sb_publishable_runtime-check",
    });
    expect(JSON.stringify(publicEnvironment)).not.toContain(
      "must-not-be-exposed",
    );
  });

  it("fails module evaluation when browser configuration is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    await expect(import("./runtime")).rejects.toThrow(
      "NEXT_PUBLIC_SUPABASE_URL is required and must not be blank",
    );
  });
});
