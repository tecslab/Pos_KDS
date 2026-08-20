import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: dependencies.redirect }));
vi.mock("../supabase/server", () => ({
  createServerSupabaseClient: dependencies.createServerSupabaseClient,
}));

import { requireAuthenticatedSession } from "./server-session";

beforeEach(() => {
  dependencies.createServerSupabaseClient.mockReset();
  dependencies.redirect.mockClear();
});

describe("requireAuthenticatedSession", () => {
  it("returns a Supabase-verified server session", async () => {
    dependencies.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: "user-1", email: "user@example.com" } },
          error: null,
        }),
      },
    });

    await expect(requireAuthenticatedSession("/orders")).resolves.toEqual({
      userId: "user-1",
      email: "user@example.com",
    });
    expect(dependencies.redirect).not.toHaveBeenCalled();
  });

  it("redirects missing or unverifiable sessions to login", async () => {
    dependencies.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    });

    await expect(
      requireAuthenticatedSession("/orders?tab=ready"),
    ).rejects.toThrow("redirect:/login?next=%2Forders%3Ftab%3Dready");
    expect(dependencies.redirect).toHaveBeenCalledWith(
      "/login?next=%2Forders%3Ftab%3Dready",
    );
  });
});
