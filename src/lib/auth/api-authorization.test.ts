import { beforeEach, describe, expect, it, vi } from "vitest";

const userId = "10000000-0000-4000-8000-000000000001";
const dependencies = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  findByAuthenticatedUserId: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../supabase/server", () => ({
  createServerSupabaseClient: dependencies.createServerSupabaseClient,
}));
vi.mock("../../infrastructure/auth", () => ({
  SupabaseAuthorizationProfileReader: class {
    findByAuthenticatedUserId(userIdToRead: string) {
      return dependencies.findByAuthenticatedUserId(userIdToRead);
    }
  },
}));

import { authorizeApiPermission } from "./api-authorization";

function claimsClient(
  claims: Record<string, unknown> | null = { sub: userId },
) {
  return {
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: claims === null ? null : { claims },
        error: null,
      }),
    },
  };
}

beforeEach(() => {
  dependencies.createServerSupabaseClient.mockReset();
  dependencies.findByAuthenticatedUserId.mockReset();
  dependencies.createServerSupabaseClient.mockResolvedValue(claimsClient());
});

describe("authorizeApiPermission", () => {
  it.each(["administrator", "waiter"])(
    "authorizes a persisted %s grant by permission code",
    async (roleCode) => {
      dependencies.findByAuthenticatedUserId.mockResolvedValue({
        userId,
        displayName: "Ana",
        isActive: true,
        roleGrants: [{ roleCode, permissionCodes: ["orders.create"] }],
      });

      const result = await authorizeApiPermission("orders.create");

      expect(result).toMatchObject({
        ok: true,
        value: { userId, permissionCodes: ["orders.create"] },
      });
      expect(dependencies.findByAuthenticatedUserId).toHaveBeenCalledWith(
        userId,
      );
    },
  );

  it("returns authentication-required before reading persistence when no session verifies", async () => {
    dependencies.createServerSupabaseClient.mockResolvedValue(
      claimsClient(null),
    );

    await expect(authorizeApiPermission("orders.create")).resolves.toEqual({
      ok: false,
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
    expect(dependencies.findByAuthenticatedUserId).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {
      userId,
      displayName: "Ana",
      isActive: false,
      roleGrants: [
        { roleCode: "administrator", permissionCodes: ["orders.create"] },
      ],
    },
    {
      userId,
      displayName: "Ana",
      isActive: true,
      roleGrants: [{ roleCode: "kitchen", permissionCodes: ["orders.view"] }],
    },
  ])("returns unauthorized for a denied persisted profile", async (profile) => {
    dependencies.findByAuthenticatedUserId.mockResolvedValue(profile);

    await expect(authorizeApiPermission("orders.create")).resolves.toEqual({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("fails closed with safe classifications for infrastructure failures", async () => {
    dependencies.createServerSupabaseClient.mockRejectedValueOnce(
      new Error("private session client detail"),
    );
    await expect(authorizeApiPermission("orders.create")).resolves.toEqual({
      ok: false,
      error: { code: "AUTHENTICATION_REQUIRED" },
    });

    dependencies.createServerSupabaseClient.mockResolvedValue(claimsClient());
    dependencies.findByAuthenticatedUserId.mockRejectedValue(
      new Error("private profile detail"),
    );
    await expect(authorizeApiPermission("orders.create")).resolves.toEqual({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
  });
});
