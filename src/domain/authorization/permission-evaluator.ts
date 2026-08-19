import { unauthorizedError, type UnauthorizedError } from "../business-error";
import { err, ok, type Result } from "../result";

export type PermissionCode = string;

export type RolePermissionGrant = Readonly<{
  roleCode: string;
  permissionCodes: readonly PermissionCode[];
}>;

export type PermissionSubject = Readonly<{
  isActive: boolean;
  roleGrants: readonly RolePermissionGrant[];
}>;

export function evaluatePermission(
  subject: PermissionSubject,
  requiredPermission: PermissionCode,
): Result<void, UnauthorizedError> {
  if (!subject.isActive || subject.roleGrants.length === 0) {
    return err(unauthorizedError());
  }

  const isGranted = subject.roleGrants.some((role) =>
    role.permissionCodes.includes(requiredPermission),
  );

  return isGranted ? ok(undefined) : err(unauthorizedError());
}
