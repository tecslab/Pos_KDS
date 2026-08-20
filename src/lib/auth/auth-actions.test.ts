import { describe, expect, it, vi } from "vitest";

import { authenticatePassword, endLocalSession } from "./auth-actions";

function signInForm(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set("email", overrides.email ?? "employee@example.com");
  formData.set("password", overrides.password ?? "private-password-value");
  formData.set("next", overrides.next ?? "/orders");
  return formData;
}

describe("authentication action core", () => {
  it("delegates credentials once and returns no credential or token data", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: { session: { access_token: "provider-token" } },
      error: null,
    });

    const result = await authenticatePassword(signInForm(), {
      signInWithPassword,
    });

    expect(signInWithPassword).toHaveBeenCalledOnce();
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "employee@example.com",
      password: "private-password-value",
    });
    expect(result).toEqual({ ok: true, nextPath: "/orders" });
    expect(JSON.stringify(result)).not.toMatch(
      /private-password-value|provider-token/,
    );
  });

  it.each([
    ["provider error", { error: new Error("private provider detail") }],
    ["provider exception", new Error("private provider exception")],
  ])("returns only a generic failure for %s", async (_label, outcome) => {
    const signInWithPassword =
      outcome instanceof Error
        ? vi.fn().mockRejectedValue(outcome)
        : vi.fn().mockResolvedValue(outcome);

    const result = await authenticatePassword(signInForm(), {
      signInWithPassword,
    });

    expect(result).toEqual({ ok: false, nextPath: "/orders" });
    expect(JSON.stringify(result)).not.toContain("private provider");
  });

  it("rejects missing credentials without calling Supabase", async () => {
    const signInWithPassword = vi.fn();

    const result = await authenticatePassword(signInForm({ password: "" }), {
      signInWithPassword,
    });

    expect(result).toEqual({ ok: false, nextPath: "/orders" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("sanitizes an external return location", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });

    const result = await authenticatePassword(
      signInForm({ next: "//attacker.example" }),
      { signInWithPassword },
    );

    expect(result.nextPath).toBe("/");
  });

  it("signs out only the local session and contains failures", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });

    await expect(endLocalSession({ signOut })).resolves.toBe(true);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    await expect(
      endLocalSession({
        signOut: vi.fn().mockRejectedValue(new Error("provider detail")),
      }),
    ).resolves.toBe(false);
  });
});
