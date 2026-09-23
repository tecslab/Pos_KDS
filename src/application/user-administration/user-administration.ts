import { err, ok, type Result } from "../../domain";
import type { AuditEventService } from "../audit";

export type ManagedUserState = "PENDING_PROFILE" | "ACTIVE" | "INACTIVE";

export type ManagedUser = Readonly<{
  id: string;
  email: string;
  displayName: string;
  state: ManagedUserState;
  roleNames: readonly string[];
  invitedAt: string | null;
  lastSignInAt: string | null;
}>;

export type InvitedUser = Readonly<{
  id: string;
  email: string;
  displayName: string;
}>;

export interface UserAdministrationGateway {
  listUsers(): Promise<readonly ManagedUser[]>;
  inviteUser(
    email: string,
    displayName: string,
    redirectTo?: string,
  ): Promise<InvitedUser>;
  setUserActive(userId: string, active: boolean): Promise<ManagedUser>;
  sendPasswordReset(userId: string): Promise<ManagedUser>;
}

export type UserAdministrationError = Readonly<{
  kind: "user-administration-error";
  code: "INVALID_INPUT" | "OPERATION_FAILED";
}>;

export class UserAdministrationService {
  constructor(
    private readonly gateway: UserAdministrationGateway,
    private readonly audit: AuditEventService,
  ) {}

  async list(): Promise<
    Result<readonly ManagedUser[], UserAdministrationError>
  > {
    try {
      return ok(Object.freeze([...(await this.gateway.listUsers())]));
    } catch {
      return failure("OPERATION_FAILED");
    }
  }

  async invite(
    actorId: string,
    input: Readonly<{ email: string; displayName: string; redirectTo?: string }>,
  ): Promise<Result<InvitedUser, UserAdministrationError>> {
    const email = normalizeEmail(input.email);
    const displayName = normalizeDisplayName(input.displayName);

    if (
      !isUuid(actorId) ||
      email === null ||
      displayName === null ||
      (input.redirectTo !== undefined && !isHttpUrl(input.redirectTo))
    ) {
      return failure("INVALID_INPUT");
    }

    const intentRecorded = await this.recordRequired({
      actorId,
      action: "user.invitation_requested",
      entityType: "application_user_invitation",
      entityId: `email:${email}`,
      newValues: { email, displayName },
    });
    if (!intentRecorded) return failure("OPERATION_FAILED");

    let invited: InvitedUser;
    try {
      invited =
        input.redirectTo === undefined
          ? await this.gateway.inviteUser(email, displayName)
          : await this.gateway.inviteUser(email, displayName, input.redirectTo);
    } catch {
      await this.recordOutcomeSafely({
        actorId,
        action: "user.invitation_failed",
        entityType: "application_user_invitation",
        entityId: `email:${email}`,
      });
      return failure("OPERATION_FAILED");
    }

    const outcomeRecorded = await this.recordRequired({
      actorId,
      action: "user.invited",
      entityType: "application_user",
      entityId: invited.id,
      newValues: { email: invited.email, displayName: invited.displayName },
    });
    return outcomeRecorded
      ? ok(Object.freeze(invited))
      : failure("OPERATION_FAILED");
  }

  async setActive(
    actorId: string,
    userId: string,
    active: boolean,
  ): Promise<Result<ManagedUser, UserAdministrationError>> {
    if (!isUuid(actorId) || !isUuid(userId) || typeof active !== "boolean") {
      return failure("INVALID_INPUT");
    }

    const intentRecorded = await this.recordRequired({
      actorId,
      action: active
        ? "user.activation_requested"
        : "user.deactivation_requested",
      entityType: "application_user",
      entityId: userId,
      previousValues: { isActive: !active },
      newValues: { isActive: active },
    });
    if (!intentRecorded) return failure("OPERATION_FAILED");

    let updated: ManagedUser;
    try {
      updated = await this.gateway.setUserActive(userId, active);
    } catch {
      await this.recordOutcomeSafely({
        actorId,
        action: active ? "user.activation_failed" : "user.deactivation_failed",
        entityType: "application_user",
        entityId: userId,
      });
      return failure("OPERATION_FAILED");
    }

    const outcomeRecorded = await this.recordRequired({
      actorId,
      action: active ? "user.activated" : "user.deactivated",
      entityType: "application_user",
      entityId: userId,
      previousValues: { isActive: !active },
      newValues: { isActive: active },
    });
    return outcomeRecorded ? ok(updated) : failure("OPERATION_FAILED");
  }

  async requestPasswordReset(
    actorId: string,
    userId: string,
  ): Promise<Result<void, UserAdministrationError>> {
    if (!isUuid(actorId) || !isUuid(userId)) {
      return failure("INVALID_INPUT");
    }

    const intentRecorded = await this.recordRequired({
      actorId,
      action: "user.password_reset_requested",
      entityType: "application_user",
      entityId: userId,
    });
    if (!intentRecorded) return failure("OPERATION_FAILED");

    let target: ManagedUser;
    try {
      target = await this.gateway.sendPasswordReset(userId);
    } catch {
      await this.recordOutcomeSafely({
        actorId,
        action: "user.password_reset_failed",
        entityType: "application_user",
        entityId: userId,
      });
      return failure("OPERATION_FAILED");
    }

    const outcomeRecorded = await this.recordRequired({
      actorId,
      action: "user.password_reset_dispatched",
      entityType: "application_user",
      entityId: target.id,
    });
    return outcomeRecorded ? ok(undefined) : failure("OPERATION_FAILED");
  }

  private async recordRequired(
    input: Parameters<AuditEventService["record"]>[0],
  ): Promise<boolean> {
    try {
      return (await this.audit.record(input)).ok;
    } catch {
      return false;
    }
  }

  private async recordOutcomeSafely(
    input: Parameters<AuditEventService["record"]>[0],
  ) {
    try {
      await this.audit.record(input);
    } catch {
      // The durable intent already records the attempted operation. Outcome
      // persistence is best-effort so provider details never escape.
    }
  }
}

function failure(
  code: UserAdministrationError["code"],
): Result<never, UserAdministrationError> {
  return err(Object.freeze({ kind: "user-administration-error", code }));
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
    ? email
    : null;
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const displayName = value.trim().replace(/\s+/g, " ");
  return displayName.length >= 2 && displayName.length <= 120
    ? displayName
    : null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
