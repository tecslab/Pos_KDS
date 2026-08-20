import {
  err,
  evaluatePermission,
  ok,
  unauthorizedError,
  type Result,
  type RolePermissionGrant,
  type UnauthorizedError,
} from "../../domain";

import type {
  AuthorizationProfile,
  AuthorizationProfileReader,
  AuthorizedEmployeeContext,
} from "./authorization-profile";

export class AuthorizationService {
  constructor(private readonly profiles: AuthorizationProfileReader) {}

  async authorize(
    authenticatedUserId: string,
    requiredPermission: string,
  ): Promise<Result<AuthorizedEmployeeContext, UnauthorizedError>> {
    if (
      !isUuid(authenticatedUserId) ||
      !isNonblank(requiredPermission) ||
      requiredPermission !== requiredPermission.trim()
    ) {
      return denied();
    }

    let persistedProfile: AuthorizationProfile | null;

    try {
      persistedProfile =
        await this.profiles.findByAuthenticatedUserId(authenticatedUserId);
    } catch {
      return denied();
    }

    try {
      const profile = normalizeProfile(persistedProfile, authenticatedUserId);

      if (profile === null) {
        return denied();
      }

      const permissionResult = evaluatePermission(profile, requiredPermission);

      if (!permissionResult.ok) {
        return denied();
      }

      return ok(
        Object.freeze({
          userId: profile.userId,
          displayName: profile.displayName,
          roleCodes: Object.freeze(
            profile.roleGrants.map((grant) => grant.roleCode),
          ),
        }),
      );
    } catch {
      return denied();
    }
  }
}

function normalizeProfile(
  profile: AuthorizationProfile | null,
  authenticatedUserId: string,
): AuthorizationProfile | null {
  if (
    typeof profile !== "object" ||
    profile === null ||
    profile.userId !== authenticatedUserId ||
    !isNonblank(profile.displayName) ||
    typeof profile.isActive !== "boolean" ||
    !Array.isArray(profile.roleGrants)
  ) {
    return null;
  }

  const roleGrants: RolePermissionGrant[] = [];
  const seenRoleCodes = new Set<string>();

  for (const grant of profile.roleGrants) {
    if (
      typeof grant !== "object" ||
      grant === null ||
      !isCanonicalCode(grant.roleCode) ||
      !Array.isArray(grant.permissionCodes) ||
      grant.permissionCodes.some((code: unknown) => !isCanonicalCode(code)) ||
      seenRoleCodes.has(grant.roleCode)
    ) {
      return null;
    }

    seenRoleCodes.add(grant.roleCode);
    roleGrants.push(
      Object.freeze({
        roleCode: grant.roleCode,
        permissionCodes: Object.freeze([...grant.permissionCodes]),
      }),
    );
  }

  return Object.freeze({
    userId: profile.userId,
    displayName: profile.displayName,
    isActive: profile.isActive,
    roleGrants: Object.freeze(roleGrants),
  });
}

function denied(): Result<never, UnauthorizedError> {
  return err(unauthorizedError());
}

function isCanonicalCode(value: unknown): value is string {
  return isNonblank(value) && value === value.trim();
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
