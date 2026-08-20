import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  AuthorizationProfileReadError,
  mapAuthorizationProfileRow,
  SupabaseAuthorizationProfileReader,
} from "./supabase-authorization-profile-reader";

const userId = "10000000-0000-4000-8000-000000000001";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: userId,
    display_name: "Ana",
    is_active: true,
    user_role_assignments: [
      {
        role: {
          code: "waiter",
          role_permissions: [
            { permission: { code: "orders.view" } },
            { permission: { code: "orders.create" } },
          ],
        },
      },
    ],
    ...overrides,
  };
}

function fakeClient(result: { data: unknown; error: unknown | null }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);

  return {
    client: { from } as unknown as SupabaseClient,
    from,
    maybeSingle,
    query,
  };
}

describe("SupabaseAuthorizationProfileReader", () => {
  it("reads only the authenticated subject and maps its persisted graph", async () => {
    const fake = fakeClient({ data: row(), error: null });
    const reader = new SupabaseAuthorizationProfileReader(fake.client);

    const result = await reader.findByAuthenticatedUserId(userId);

    expect(fake.from).toHaveBeenCalledWith("application_users");
    expect(fake.query.eq).toHaveBeenCalledWith("id", userId);
    expect(fake.query.select.mock.calls[0]?.[0]).toContain(
      "user_role_assignments",
    );
    expect(result).toEqual({
      userId,
      displayName: "Ana",
      isActive: true,
      roleGrants: [
        {
          roleCode: "waiter",
          permissionCodes: ["orders.view", "orders.create"],
        },
      ],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.roleGrants)).toBe(true);
  });

  it("returns null for a missing or malformed graph", async () => {
    const missing = fakeClient({ data: null, error: null });
    const malformed = fakeClient({
      data: row({ user_role_assignments: [{ role: null }] }),
      error: null,
    });

    await expect(
      new SupabaseAuthorizationProfileReader(
        missing.client,
      ).findByAuthenticatedUserId(userId),
    ).resolves.toBeNull();
    await expect(
      new SupabaseAuthorizationProfileReader(
        malformed.client,
      ).findByAuthenticatedUserId(userId),
    ).resolves.toBeNull();
  });

  it("replaces provider errors with a stable infrastructure error", async () => {
    const fake = fakeClient({
      data: null,
      error: { message: "private database detail" },
    });

    await expect(
      new SupabaseAuthorizationProfileReader(
        fake.client,
      ).findByAuthenticatedUserId(userId),
    ).rejects.toEqual(new AuthorizationProfileReadError());
  });

  it("replaces thrown query failures with a stable infrastructure error", async () => {
    const fake = fakeClient({ data: null, error: null });
    fake.maybeSingle.mockRejectedValue(new Error("private query detail"));

    await expect(
      new SupabaseAuthorizationProfileReader(
        fake.client,
      ).findByAuthenticatedUserId(userId),
    ).rejects.toEqual(new AuthorizationProfileReadError());
  });
});

describe("mapAuthorizationProfileRow", () => {
  it.each([
    undefined,
    {},
    row({ id: 42 }),
    row({ is_active: "true" }),
    row({ user_role_assignments: "not-an-array" }),
    row({
      user_role_assignments: [
        { role: { code: "waiter", role_permissions: [{}] } },
      ],
    }),
  ])("fails closed for malformed persisted data", (value) => {
    expect(mapAuthorizationProfileRow(value)).toBeNull();
  });
});
