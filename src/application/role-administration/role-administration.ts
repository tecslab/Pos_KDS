import { err, ok, type Result } from "../../domain";
import type { AuditEventService } from "../audit";

export type InspectablePermission = Readonly<{
  code: string;
  name: string;
  description: string | null;
}>;

export type AssignableRole = Readonly<{
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: readonly InspectablePermission[];
}>;

export type RoleAssignmentEmployee = Readonly<{
  id: string;
  email: string;
  displayName: string;
  roleIds: readonly string[];
}>;

export type RoleAdministrationView = Readonly<{
  roles: readonly AssignableRole[];
  employees: readonly RoleAssignmentEmployee[];
}>;

export type RoleAssignmentChange = Readonly<{
  previousRoleIds: readonly string[];
  assignedRoleIds: readonly string[];
}>;

export interface RoleAdministrationGateway {
  listRoles(): Promise<readonly AssignableRole[]>;
  listEmployees(): Promise<readonly RoleAssignmentEmployee[]>;
  replaceRoles(
    userId: string,
    roleIds: readonly string[],
  ): Promise<RoleAssignmentChange>;
}

export type RoleAdministrationError = Readonly<{
  kind: "role-administration-error";
  code: "INVALID_INPUT" | "OPERATION_FAILED";
}>;

export class RoleAdministrationService {
  constructor(
    private readonly gateway: RoleAdministrationGateway,
    private readonly audit: AuditEventService,
  ) {}

  async read(): Promise<
    Result<RoleAdministrationView, RoleAdministrationError>
  > {
    try {
      const [roles, employees] = await Promise.all([
        this.gateway.listRoles(),
        this.gateway.listEmployees(),
      ]);
      return ok(
        Object.freeze({
          roles: Object.freeze([...roles]),
          employees: Object.freeze([...employees]),
        }),
      );
    } catch {
      return failure("OPERATION_FAILED");
    }
  }

  async replaceRoles(
    actorId: string,
    input: Readonly<{
      userId: string;
      roleIds: readonly string[];
    }>,
  ): Promise<Result<RoleAssignmentChange, RoleAdministrationError>> {
    const roleIds = normalizeRoleIds(input.roleIds);
    if (!isUuid(actorId) || !isUuid(input.userId) || roleIds === null) {
      return failure("INVALID_INPUT");
    }

    const intentRecorded = await this.recordRequired({
      actorId,
      action: "user.roles_assignment_requested",
      entityType: "application_user",
      entityId: input.userId,
      newValues: { roleIds },
    });
    if (!intentRecorded) return failure("OPERATION_FAILED");

    let change: RoleAssignmentChange;
    try {
      change = await this.gateway.replaceRoles(input.userId, roleIds);
    } catch {
      await this.recordOutcomeSafely({
        actorId,
        action: "user.roles_assignment_failed",
        entityType: "application_user",
        entityId: input.userId,
      });
      return failure("OPERATION_FAILED");
    }

    const outcomeRecorded = await this.recordRequired({
      actorId,
      action: "user.roles_assigned",
      entityType: "application_user",
      entityId: input.userId,
      previousValues: { roleIds: change.previousRoleIds },
      newValues: { roleIds: change.assignedRoleIds },
    });
    return outcomeRecorded
      ? ok(Object.freeze(change))
      : failure("OPERATION_FAILED");
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
      // The durable intent remains the authoritative attempted-operation audit.
    }
  }
}

function normalizeRoleIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.some((item) => !isUuid(item))) return null;
  const unique = new Set(value);
  if (unique.size !== value.length) return null;
  return Object.freeze([...unique].sort());
}

function failure(
  code: RoleAdministrationError["code"],
): Result<never, RoleAdministrationError> {
  return err(Object.freeze({ kind: "role-administration-error", code }));
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
