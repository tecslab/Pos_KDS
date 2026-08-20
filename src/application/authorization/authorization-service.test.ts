import { describe, expect, it, vi } from "vitest";

import { unauthorizedError } from "../../domain";

import type {
  AuthorizationProfile,
  AuthorizationProfileReader,
} from "./authorization-profile";
import { AuthorizationService } from "./authorization-service";

const userId = "10000000-0000-4000-8000-000000000001";
const otherUserId = "10000000-0000-4000-8000-000000000002";

function profile(
  overrides: Partial<AuthorizationProfile> = {},
): AuthorizationProfile {
  return {
    userId,
    displayName: "Ana",
    isActive: true,
    roleGrants: [
      { roleCode: "waiter", permissionCodes: ["orders.view"] },
      { roleCode: "cashier", permissionCodes: ["payments.record"] },
    ],
    ...overrides,
  };
}

function reader(
  value: AuthorizationProfile | null,
): AuthorizationProfileReader {
  return {
    findByAuthenticatedUserId: vi.fn().mockResolvedValue(value),
  };
}

describe("AuthorizationService", () => {
  it("authorizes from the persisted union of roles and returns a frozen context", async () => {
    const profiles = reader(profile());
    const result = await new AuthorizationService(profiles).authorize(
      userId,
      "payments.record",
    );

    expect(result).toEqual({
      ok: true,
      value: {
        userId,
        displayName: "Ana",
        roleCodes: ["waiter", "cashier"],
      },
    });
    expect(profiles.findByAuthenticatedUserId).toHaveBeenCalledWith(userId);
    expect(result.ok && Object.isFrozen(result.value)).toBe(true);
    expect(result.ok && Object.isFrozen(result.value.roleCodes)).toBe(true);
  });

  it.each([
    ["missing profile", null],
    ["inactive profile", profile({ isActive: false })],
    ["no roles", profile({ roleGrants: [] })],
    ["missing permission", profile()],
    ["cross-user profile", profile({ userId: otherUserId })],
    [
      "malformed permission",
      profile({
        roleGrants: [{ roleCode: "waiter", permissionCodes: [" orders.view"] }],
      }),
    ],
    [
      "duplicate persisted role",
      profile({
        roleGrants: [
          { roleCode: "waiter", permissionCodes: ["orders.view"] },
          { roleCode: "waiter", permissionCodes: ["orders.view"] },
        ],
      }),
    ],
  ])("fails closed for %s", async (label, persistedProfile) => {
    const permission =
      label === "missing permission" ? "users.manage" : "orders.view";
    const result = await new AuthorizationService(
      reader(persistedProfile),
    ).authorize(userId, permission);

    expect(result).toEqual({ ok: false, error: unauthorizedError() });
  });

  it("fails closed for invalid input before reading persistence", async () => {
    const profiles = reader(profile());

    await expect(
      new AuthorizationService(profiles).authorize("not-a-uuid", "orders.view"),
    ).resolves.toEqual({ ok: false, error: unauthorizedError() });
    await expect(
      new AuthorizationService(profiles).authorize(userId, " "),
    ).resolves.toEqual({ ok: false, error: unauthorizedError() });
    expect(profiles.findByAuthenticatedUserId).not.toHaveBeenCalled();
  });

  it("sanitizes repository failures", async () => {
    const profiles: AuthorizationProfileReader = {
      findByAuthenticatedUserId: vi
        .fn()
        .mockRejectedValue(new Error("database connection detail")),
    };

    const result = await new AuthorizationService(profiles).authorize(
      userId,
      "orders.view",
    );

    expect(result).toEqual({ ok: false, error: unauthorizedError() });
    expect(JSON.stringify(result)).not.toContain("database connection detail");
  });

  it("fails closed for accessor-bearing repository data", async () => {
    const maliciousProfile = Object.defineProperty(
      {
        userId,
        displayName: "Ana",
        isActive: true,
      },
      "roleGrants",
      {
        get: () => {
          throw new Error("malicious getter detail");
        },
      },
    );

    await expect(
      new AuthorizationService(
        reader(maliciousProfile as AuthorizationProfile),
      ).authorize(userId, "orders.view"),
    ).resolves.toEqual({ ok: false, error: unauthorizedError() });
  });
});
