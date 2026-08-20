import { beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorizedError } from "../../domain";

const dependencies = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  findByAuthenticatedUserId: vi.fn(),
  profileReader: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: dependencies.redirect }));
vi.mock("../supabase/server", () => ({
  createServerSupabaseClient: dependencies.createServerSupabaseClient,
}));
vi.mock("../../infrastructure/auth", () => ({
  SupabaseAuthorizationProfileReader: class {
    constructor() {
      dependencies.profileReader();
    }

    findByAuthenticatedUserId(userIdToRead: string) {
      return dependencies.findByAuthenticatedUserId(userIdToRead);
    }
  },
}));

import { requireServerPermission } from "./server-authorization";

const userId = "10000000-0000-4000-8000-000000000001";

function claimsClient(
  claims: Record<string, unknown> | null = { sub: userId },
) {
  return {
    auth: {
      getClaims: vi.fn(async () => ({
        data: claims === null ? null : { claims },
        error: null,
      })),
    },
  };
}

beforeEach(() => {
  dependencies.createServerSupabaseClient.mockReset();
  dependencies.findByAuthenticatedUserId.mockReset();
  dependencies.profileReader.mockReset();
  dependencies.redirect.mockClear();
  dependencies.createServerSupabaseClient.mockResolvedValue(claimsClient());
});

describe("requireServerPermission", () => {
  it("returns a frozen context after authentication and persisted authorization", async () => {
    dependencies.findByAuthenticatedUserId.mockResolvedValue({
      userId,
      displayName: "Ana",
      isActive: true,
      roleGrants: [{ roleCode: "waiter", permissionCodes: ["orders.view"] }],
    });

    const result = await requireServerPermission("orders.view", "/orders");

    expect(result).toEqual({
      userId,
      displayName: "Ana",
      roleCodes: ["waiter"],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(dependencies.findByAuthenticatedUserId).toHaveBeenCalledWith(userId);
  });

  it("redirects an unverifiable session before persistence is read", async () => {
    dependencies.createServerSupabaseClient.mockResolvedValue(
      claimsClient(null),
    );

    await expect(
      requireServerPermission("orders.view", "/orders?status=ready"),
    ).rejects.toThrow("redirect:/login?next=%2Forders%3Fstatus%3Dready");
    expect(dependencies.profileReader).not.toHaveBeenCalled();
  });

  it("fails closed if authentication infrastructure cannot be created", async () => {
    dependencies.createServerSupabaseClient.mockRejectedValue(
      new Error("private configuration detail"),
    );

    await expect(
      requireServerPermission("orders.view", "/orders"),
    ).rejects.toThrow("redirect:/login?next=%2Forders");
  });

  it("ignores forged JWT role and permission claims", async () => {
    dependencies.createServerSupabaseClient.mockResolvedValue(
      claimsClient({
        sub: userId,
        role: "administrator",
        permissions: ["users.manage"],
      }),
    );
    dependencies.findByAuthenticatedUserId.mockResolvedValue({
      userId,
      displayName: "Ana",
      isActive: true,
      roleGrants: [{ roleCode: "waiter", permissionCodes: ["orders.view"] }],
    });

    await expect(
      requireServerPermission("users.manage", "/admin/users"),
    ).rejects.toEqual(unauthorizedError());
  });

  it.each([
    {
      label: "inactive profile",
      persistedProfile: {
        userId,
        displayName: "Ana",
        isActive: false,
        roleGrants: [
          { roleCode: "administrator", permissionCodes: ["users.manage"] },
        ],
      },
    },
    {
      label: "cross-user profile",
      persistedProfile: {
        userId: "10000000-0000-4000-8000-000000000002",
        displayName: "Other",
        isActive: true,
        roleGrants: [
          { roleCode: "administrator", permissionCodes: ["users.manage"] },
        ],
      },
    },
  ])("fails closed for $label", async ({ persistedProfile }) => {
    dependencies.findByAuthenticatedUserId.mockResolvedValue(persistedProfile);

    await expect(
      requireServerPermission("users.manage", "/admin/users"),
    ).rejects.toEqual(unauthorizedError());
  });

  it("sanitizes profile-reader creation and read failures", async () => {
    dependencies.profileReader.mockImplementationOnce(() => {
      throw new Error("private adapter construction detail");
    });

    await expect(
      requireServerPermission("users.manage", "/admin/users"),
    ).rejects.toEqual(unauthorizedError());

    dependencies.findByAuthenticatedUserId.mockRejectedValue(
      new Error("private database detail"),
    );

    await expect(
      requireServerPermission("users.manage", "/admin/users"),
    ).rejects.toEqual(unauthorizedError());
  });
});
