import type { RolePermissionGrant } from "../../domain";

export type AuthorizationProfile = Readonly<{
  userId: string;
  displayName: string;
  isActive: boolean;
  roleGrants: readonly RolePermissionGrant[];
}>;

export interface AuthorizationProfileReader {
  findByAuthenticatedUserId(
    authenticatedUserId: string,
  ): Promise<AuthorizationProfile | null>;
}

export type AuthorizedEmployeeContext = Readonly<{
  userId: string;
  displayName: string;
  roleCodes: readonly string[];
  permissionCodes: readonly string[];
}>;
