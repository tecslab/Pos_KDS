import type { SupabaseClient, User } from "@supabase/supabase-js";

import type {
  InvitedUser,
  ManagedUser,
  UserAdministrationGateway,
} from "../../application";

const PROFILE_QUERY = `
  id,
  display_name,
  is_active,
  user_role_assignments (role:roles (name))
`;
const LONG_BAN_DURATION = "876000h";

export class UserAdministrationInfrastructureError extends Error {
  constructor() {
    super("The user administration operation failed.");
    this.name = "UserAdministrationInfrastructureError";
  }
}

export class SupabaseUserAdministrationGateway implements UserAdministrationGateway {
  constructor(private readonly client: SupabaseClient) {}

  async listUsers(): Promise<readonly ManagedUser[]> {
    try {
      const [
        { data: authData, error: authError },
        { data: profiles, error: profileError },
      ] = await Promise.all([
        this.client.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        this.client.from("application_users").select(PROFILE_QUERY),
      ]);

      if (authError !== null || profileError !== null) throw new Error();
      const profileById = mapProfiles(profiles);
      return Object.freeze(
        authData.users
          .map((user) => toManagedUser(user, profileById.get(user.id)))
          .sort((left, right) =>
            left.displayName.localeCompare(right.displayName, "es"),
          ),
      );
    } catch {
      throw new UserAdministrationInfrastructureError();
    }
  }

  async inviteUser(
    email: string,
    displayName: string,
    redirectTo?: string,
  ): Promise<InvitedUser> {
    try {
      const options: { data: { display_name: string }; redirectTo?: string } = {
        data: { display_name: displayName },
      };
      if (redirectTo !== undefined) options.redirectTo = redirectTo;
      const { data, error } = await this.client.auth.admin.inviteUserByEmail(
        email,
        options,
      );
      if (error !== null || data.user === null) throw new Error();
      return Object.freeze({ id: data.user.id, email, displayName });
    } catch {
      throw new UserAdministrationInfrastructureError();
    }
  }

  async setUserActive(userId: string, active: boolean): Promise<ManagedUser> {
    try {
      const target = await this.getManagedUser(userId);
      if (target.state === "PENDING_PROFILE") throw new Error();
      if ((target.state === "ACTIVE") === active) throw new Error();

      if (active) {
        await this.updateAuthBan(userId, "none");
        try {
          await this.updateProfileActive(userId, true);
        } catch {
          await this.restoreFailClosedBan(userId);
          throw new Error();
        }
      } else {
        await this.updateProfileActive(userId, false);
        try {
          await this.updateAuthBan(userId, LONG_BAN_DURATION);
        } catch {
          await this.restoreFailClosedBan(userId);
          throw new Error();
        }
      }

      return Object.freeze({
        ...target,
        state: active ? "ACTIVE" : "INACTIVE",
      });
    } catch {
      throw new UserAdministrationInfrastructureError();
    }
  }

  async sendPasswordReset(
    userId: string,
    redirectTo?: string,
  ): Promise<ManagedUser> {
    try {
      const target = await this.getManagedUser(userId);
      const { error } =
        redirectTo === undefined
          ? await this.client.auth.resetPasswordForEmail(target.email)
          : await this.client.auth.resetPasswordForEmail(target.email, {
              redirectTo,
            });
      if (error !== null) throw new Error();
      return target;
    } catch {
      throw new UserAdministrationInfrastructureError();
    }
  }

  private async getManagedUser(userId: string): Promise<ManagedUser> {
    const [
      { data: authData, error: authError },
      { data: profile, error: profileError },
    ] = await Promise.all([
      this.client.auth.admin.getUserById(userId),
      this.client
        .from("application_users")
        .select(PROFILE_QUERY)
        .eq("id", userId)
        .maybeSingle(),
    ]);
    if (authError !== null || profileError !== null || authData.user === null)
      throw new Error();
    return toManagedUser(authData.user, mapProfile(profile));
  }

  private async updateAuthBan(userId: string, banDuration: string) {
    const { error } = await this.client.auth.admin.updateUserById(userId, {
      ban_duration: banDuration,
    });
    if (error !== null) throw new Error();
  }

  private async updateProfileActive(userId: string, active: boolean) {
    const { error } = await this.client
      .from("application_users")
      .update({ is_active: active })
      .eq("id", userId);
    if (error !== null) throw new Error();
  }

  private async restoreFailClosedBan(userId: string) {
    try {
      await this.updateAuthBan(userId, LONG_BAN_DURATION);
    } catch {
      // The persisted profile remains inactive, which the server guard treats
      // as authoritative even if the provider reconciliation must be retried.
    }
  }
}

type Profile = Readonly<{
  id: string;
  displayName: string;
  isActive: boolean;
  roleNames: readonly string[];
}>;

function mapProfiles(value: unknown): Map<string, Profile> {
  if (!Array.isArray(value)) throw new Error();
  const profiles = new Map<string, Profile>();
  for (const row of value) {
    const profile = mapProfile(row);
    if (profile === null) throw new Error();
    profiles.set(profile.id, profile);
  }
  return profiles;
}

function mapProfile(value: unknown): Profile | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.display_name !== "string" ||
    typeof value.is_active !== "boolean" ||
    !Array.isArray(value.user_role_assignments)
  )
    return null;
  const roleNames: string[] = [];
  for (const assignment of value.user_role_assignments) {
    if (
      !isRecord(assignment) ||
      !isRecord(assignment.role) ||
      typeof assignment.role.name !== "string"
    )
      return null;
    roleNames.push(assignment.role.name);
  }
  return Object.freeze({
    id: value.id,
    displayName: value.display_name,
    isActive: value.is_active,
    roleNames: Object.freeze(roleNames),
  });
}

function toManagedUser(user: User, profile?: Profile | null): ManagedUser {
  const email = user.email;
  if (!email) throw new Error();
  const metadataName =
    isRecord(user.user_metadata) &&
    typeof user.user_metadata.display_name === "string"
      ? user.user_metadata.display_name
      : email;
  return Object.freeze({
    id: user.id,
    email,
    displayName: profile?.displayName ?? metadataName,
    state: profile
      ? profile.isActive
        ? "ACTIVE"
        : "INACTIVE"
      : "PENDING_PROFILE",
    roleNames: profile?.roleNames ?? Object.freeze([]),
    invitedAt: user.invited_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
