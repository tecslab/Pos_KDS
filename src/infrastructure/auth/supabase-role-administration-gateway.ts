import type { SupabaseClient, User } from "@supabase/supabase-js";

import type {
  AssignableRole,
  InspectablePermission,
  RoleAdministrationGateway,
  RoleAssignmentChange,
  RoleAssignmentEmployee,
} from "../../application";

const ROLE_QUERY = `
  id,
  code,
  name,
  description,
  role_permissions (permission:permissions (code, name, description))
`;
const PROFILE_QUERY = `id, display_name, user_role_assignments (role_id)`;

export class RoleAdministrationInfrastructureError extends Error {
  constructor() {
    super("The role administration operation failed.");
    this.name = "RoleAdministrationInfrastructureError";
  }
}

export class SupabaseRoleAdministrationGateway implements RoleAdministrationGateway {
  constructor(private readonly client: SupabaseClient) {}

  async listRoles(): Promise<readonly AssignableRole[]> {
    try {
      const { data, error } = await this.client
        .from("roles")
        .select(ROLE_QUERY);
      if (error !== null || !Array.isArray(data)) throw new Error();
      return Object.freeze(
        data
          .map(mapRole)
          .sort((left, right) => left.name.localeCompare(right.name, "es")),
      );
    } catch {
      throw new RoleAdministrationInfrastructureError();
    }
  }

  async listEmployees(): Promise<readonly RoleAssignmentEmployee[]> {
    try {
      const [authResult, profileResult] = await Promise.all([
        this.client.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        this.client.from("application_users").select(PROFILE_QUERY),
      ]);
      if (authResult.error !== null || profileResult.error !== null)
        throw new Error();
      const profiles = mapProfiles(profileResult.data);
      return Object.freeze(
        authResult.data.users
          .map((user) => mapEmployee(user, profiles.get(user.id)))
          .sort((left, right) =>
            left.displayName.localeCompare(right.displayName, "es"),
          ),
      );
    } catch {
      throw new RoleAdministrationInfrastructureError();
    }
  }

  async replaceRoles(
    userId: string,
    roleIds: readonly string[],
  ): Promise<RoleAssignmentChange> {
    try {
      const { data: authData, error: authError } =
        await this.client.auth.admin.getUserById(userId);
      if (authError !== null || authData.user === null) throw new Error();
      const displayName = authenticatedDisplayName(authData.user);
      const { data, error } = await this.client.rpc(
        "replace_application_user_roles",
        {
          target_user_id: userId,
          target_display_name: displayName,
          desired_role_ids: roleIds,
        },
      );
      if (error !== null || !Array.isArray(data) || data.length !== 1)
        throw new Error();
      const row: unknown = data[0];
      if (
        !isRecord(row) ||
        !isUuidArray(row.previous_role_ids) ||
        !isUuidArray(row.assigned_role_ids)
      )
        throw new Error();
      return Object.freeze({
        previousRoleIds: Object.freeze([...row.previous_role_ids]),
        assignedRoleIds: Object.freeze([...row.assigned_role_ids]),
      });
    } catch {
      throw new RoleAdministrationInfrastructureError();
    }
  }
}

type Profile = Readonly<{
  displayName: string;
  roleIds: readonly string[];
}>;

function mapRole(value: unknown): AssignableRole {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.code !== "string" ||
    typeof value.name !== "string" ||
    !(typeof value.description === "string" || value.description === null) ||
    !Array.isArray(value.role_permissions)
  )
    throw new Error();
  const permissions = value.role_permissions.map(
    (entry): InspectablePermission => {
      if (!isRecord(entry) || !isRecord(entry.permission)) throw new Error();
      const permission = entry.permission;
      if (
        typeof permission.code !== "string" ||
        typeof permission.name !== "string" ||
        !(
          typeof permission.description === "string" ||
          permission.description === null
        )
      )
        throw new Error();
      return Object.freeze({
        code: permission.code,
        name: permission.name,
        description: permission.description,
      });
    },
  );
  permissions.sort((left, right) => left.name.localeCompare(right.name, "es"));
  return Object.freeze({
    id: value.id,
    code: value.code,
    name: value.name,
    description: value.description,
    permissions: Object.freeze(permissions),
  });
}

function mapProfiles(value: unknown): Map<string, Profile> {
  if (!Array.isArray(value)) throw new Error();
  const profiles = new Map<string, Profile>();
  for (const row of value) {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      typeof row.display_name !== "string" ||
      !Array.isArray(row.user_role_assignments)
    )
      throw new Error();
    const roleIds = row.user_role_assignments.map((assignment) => {
      if (!isRecord(assignment) || typeof assignment.role_id !== "string")
        throw new Error();
      return assignment.role_id;
    });
    profiles.set(
      row.id,
      Object.freeze({
        displayName: row.display_name,
        roleIds: Object.freeze(roleIds.sort()),
      }),
    );
  }
  return profiles;
}

function mapEmployee(user: User, profile?: Profile): RoleAssignmentEmployee {
  if (!user.email) throw new Error();
  return Object.freeze({
    id: user.id,
    email: user.email,
    displayName: profile?.displayName ?? authenticatedDisplayName(user),
    roleIds: profile?.roleIds ?? Object.freeze([]),
  });
}

function authenticatedDisplayName(user: User): string {
  if (!user.email) throw new Error();
  const metadataName =
    isRecord(user.user_metadata) &&
    typeof user.user_metadata.display_name === "string"
      ? user.user_metadata.display_name.trim().replace(/\s+/g, " ")
      : "";
  const displayName = metadataName.length >= 2 ? metadataName : user.email;
  if (displayName.length > 120) throw new Error();
  return displayName;
}

function isUuidArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
