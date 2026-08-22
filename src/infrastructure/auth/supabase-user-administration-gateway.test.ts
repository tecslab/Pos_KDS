import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { SupabaseUserAdministrationGateway } from "./supabase-user-administration-gateway";

const userId = "20000000-0000-4000-8000-000000000002";

function clientFor(
  options: {
    active?: boolean;
    authErrors?: readonly boolean[];
    profileErrors?: readonly boolean[];
  } = {},
) {
  const events: string[] = [];
  const authUser = {
    id: userId,
    email: "user@example.com",
    user_metadata: { display_name: "Usuario" },
    invited_at: null,
    last_sign_in_at: null,
  };
  const profile = {
    id: userId,
    display_name: "Usuario",
    is_active: options.active ?? true,
    user_role_assignments: [{ role: { name: "Waiter" } }],
  };
  const inviteUserByEmail = vi.fn().mockResolvedValue({
    data: { user: authUser },
    error: null,
  });
  const authErrors = [...(options.authErrors ?? [])];
  const profileErrors = [...(options.profileErrors ?? [])];
  const updateUserById = vi.fn().mockImplementation(async () => {
    events.push("auth");
    return { error: authErrors.shift() ? { message: "failure" } : null };
  });
  const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
  const profileSelect = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: profile, error: null }),
  };
  const profileUpdate = {
    eq: vi.fn().mockImplementation(async () => {
      events.push("profile");
      return { error: profileErrors.shift() ? { message: "failure" } : null };
    }),
  };
  const from = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue(profileSelect),
    update: vi.fn().mockReturnValue(profileUpdate),
  });
  const client = {
    auth: {
      admin: {
        inviteUserByEmail,
        updateUserById,
        getUserById: vi
          .fn()
          .mockResolvedValue({ data: { user: authUser }, error: null }),
      },
      resetPasswordForEmail,
    },
    from,
  } as unknown as SupabaseClient;
  return {
    gateway: new SupabaseUserAdministrationGateway(client),
    inviteUserByEmail,
    updateUserById,
    resetPasswordForEmail,
    events,
  };
}

describe("SupabaseUserAdministrationGateway", () => {
  it("invites through Auth with display metadata only", async () => {
    const { gateway, inviteUserByEmail } = clientFor();

    await gateway.inviteUser("new@example.com", "Nueva Persona");

    expect(inviteUserByEmail).toHaveBeenCalledWith("new@example.com", {
      data: { display_name: "Nueva Persona" },
    });
    expect(JSON.stringify(inviteUserByEmail.mock.calls)).not.toMatch(
      /password|role|token/i,
    );
  });

  it("deactivates the persisted profile before banning Auth", async () => {
    const { gateway, events, updateUserById } = clientFor({ active: true });

    await gateway.setUserActive(userId, false);

    expect(events).toEqual(["profile", "auth"]);
    expect(updateUserById).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ ban_duration: expect.any(String) }),
    );
  });

  it("unbans Auth before activating the persisted profile", async () => {
    const { gateway, events, updateUserById } = clientFor({ active: false });

    await gateway.setUserActive(userId, true);

    expect(events).toEqual(["auth", "profile"]);
    expect(updateUserById).toHaveBeenCalledWith(userId, {
      ban_duration: "none",
    });
  });

  it("rejects stale no-op transitions instead of emitting false audit state", async () => {
    const { gateway, events } = clientFor({ active: true });

    await expect(gateway.setUserActive(userId, true)).rejects.toThrow(
      "user administration operation failed",
    );
    expect(events).toEqual([]);
  });

  it("re-bans Auth when profile activation fails after an unban", async () => {
    const { gateway, events, updateUserById } = clientFor({
      active: false,
      profileErrors: [true],
    });

    await expect(gateway.setUserActive(userId, true)).rejects.toThrow(
      "user administration operation failed",
    );
    expect(events).toEqual(["auth", "profile", "auth"]);
    expect(updateUserById).toHaveBeenLastCalledWith(
      userId,
      expect.objectContaining({
        ban_duration: expect.not.stringMatching(/^none$/),
      }),
    );
  });

  it("retries the Auth ban after a partial deactivation failure", async () => {
    const { gateway, events, updateUserById } = clientFor({
      active: true,
      authErrors: [true, false],
    });

    await expect(gateway.setUserActive(userId, false)).rejects.toThrow(
      "user administration operation failed",
    );
    expect(events).toEqual(["profile", "auth", "auth"]);
    expect(updateUserById).toHaveBeenCalledTimes(2);
  });

  it("remains fail closed when provider ban reconciliation also fails", async () => {
    const { gateway, events } = clientFor({
      active: true,
      authErrors: [true, true],
    });

    await expect(gateway.setUserActive(userId, false)).rejects.toThrow(
      "user administration operation failed",
    );
    expect(events).toEqual(["profile", "auth", "auth"]);
  });

  it("requests a provider reset email without receiving credentials", async () => {
    const { gateway, resetPasswordForEmail } = clientFor();

    await gateway.sendPasswordReset(userId);

    expect(resetPasswordForEmail).toHaveBeenCalledWith("user@example.com");
  });
});
