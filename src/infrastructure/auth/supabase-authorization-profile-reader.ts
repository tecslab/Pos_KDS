import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuthorizationProfile,
  AuthorizationProfileReader,
} from "../../application";

const PROFILE_QUERY = `
  id,
  display_name,
  is_active,
  user_role_assignments (
    role:roles (
      code,
      role_permissions (
        permission:permissions (code)
      )
    )
  )
`;

export class AuthorizationProfileReadError extends Error {
  constructor() {
    super("The authorization profile could not be read.");
    this.name = "AuthorizationProfileReadError";
  }
}

/** Reads only the current authenticated subject through the database RLS graph. */
export class SupabaseAuthorizationProfileReader implements AuthorizationProfileReader {
  constructor(private readonly client: SupabaseClient) {}

  async findByAuthenticatedUserId(
    authenticatedUserId: string,
  ): Promise<AuthorizationProfile | null> {
    try {
      const { data, error } = await this.client
        .from("application_users")
        .select(PROFILE_QUERY)
        .eq("id", authenticatedUserId)
        .maybeSingle();

      if (error !== null) {
        throw new AuthorizationProfileReadError();
      }

      return mapAuthorizationProfileRow(data);
    } catch {
      throw new AuthorizationProfileReadError();
    }
  }
}

export function mapAuthorizationProfileRow(
  value: unknown,
): AuthorizationProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const assignments = value.user_role_assignments;

  if (
    typeof value.id !== "string" ||
    typeof value.display_name !== "string" ||
    typeof value.is_active !== "boolean" ||
    !Array.isArray(assignments)
  ) {
    return null;
  }

  const roleGrants: AuthorizationProfile["roleGrants"][number][] = [];

  for (const assignment of assignments) {
    if (!isRecord(assignment) || !isRecord(assignment.role)) {
      return null;
    }

    const role = assignment.role;
    const rolePermissions = role.role_permissions;

    if (typeof role.code !== "string" || !Array.isArray(rolePermissions)) {
      return null;
    }

    const permissionCodes: string[] = [];

    for (const rolePermission of rolePermissions) {
      if (
        !isRecord(rolePermission) ||
        !isRecord(rolePermission.permission) ||
        typeof rolePermission.permission.code !== "string"
      ) {
        return null;
      }

      permissionCodes.push(rolePermission.permission.code);
    }

    roleGrants.push(
      Object.freeze({
        roleCode: role.code,
        permissionCodes: Object.freeze(permissionCodes),
      }),
    );
  }

  return Object.freeze({
    userId: value.id,
    displayName: value.display_name,
    isActive: value.is_active,
    roleGrants: Object.freeze(roleGrants),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
