// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.hoisted(() =>
  vi.fn((url: unknown, key: unknown, options: unknown) => {
    void url;
    void key;
    void options;
    return { auth: {} };
  }),
);

type CapturedOptions = {
  auth: {
    flowType: string;
    persistSession: boolean;
    autoRefreshToken: boolean;
    detectSessionInUrl: (url: URL, params: Record<string, string>) => boolean;
    storage: {
      getItem(key: string): Promise<string | null>;
      setItem(key: string, value: string): Promise<void>;
      removeItem(key: string): Promise<void>;
    };
  };
};

vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("../config/runtime", () => ({
  publicEnvironment: {
    supabaseUrl: "https://project.example",
    supabasePublishableKey: "sb_publishable_test",
  },
}));

import { createImplicitPasswordLinkClient } from "./implicit-password-link-client";

describe("implicit password-link browser client", () => {
  beforeEach(() => {
    createClient.mockClear();
    document.cookie = "";
  });

  it("creates a fresh implicit client with restrictive URL detection", () => {
    createImplicitPasswordLinkClient();
    createImplicitPasswordLinkClient();

    expect(createClient).toHaveBeenCalledTimes(2);
    const options = createClient.mock.calls[0]?.[2] as CapturedOptions;
    expect(options?.auth).toMatchObject({
      flowType: "implicit",
      persistSession: true,
      autoRefreshToken: true,
    });
    const detect = options?.auth?.detectSessionInUrl;
    expect(typeof detect).toBe("function");
    const complete = new URL(
      "https://carnales.example/auth/accept-invite?mode=recovery#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=recovery",
    );
    expect(detect(complete, {})).toBe(true);
    expect(
      detect(
        new URL("https://carnales.example/auth/accept-invite?mode=recovery"),
        {},
      ),
    ).toBe(false);
  });

  it("persists chunked session JSON in cookies readable by SSR encoding", async () => {
    createImplicitPasswordLinkClient();
    const options = createClient.mock.calls[0]?.[2] as CapturedOptions;
    const storage = options.auth.storage;
    const value = JSON.stringify({
      access_token: "a".repeat(4000),
      refresh_token: "b".repeat(1000),
    });

    await storage.setItem("sb-project-auth-token", value);

    expect(document.cookie).toContain("sb-project-auth-token.0=base64-");
    await expect(storage.getItem("sb-project-auth-token")).resolves.toBe(value);
    await storage.removeItem("sb-project-auth-token");
    await expect(storage.getItem("sb-project-auth-token")).resolves.toBeNull();
  });
});
