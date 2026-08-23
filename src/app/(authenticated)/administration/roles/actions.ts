"use server";

import { redirect } from "next/navigation";

import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createRoleAdministrationService } from "@/lib/role-administration/server";

const PAGE_PATH = "/administration/roles";
const REQUIRED_PERMISSION = "administration.users.manage";

export async function replaceUserRoles(formData: FormData): Promise<never> {
  const actor = await requireServerPermission(REQUIRED_PERMISSION, PAGE_PATH);
  const result = await createRoleAdministrationService().replaceRoles(
    actor.userId,
    {
      userId: stringValue(formData.get("userId")),
      roleIds: formData
        .getAll("roleId")
        .filter((value): value is string => typeof value === "string"),
    },
  );
  redirect(
    `${PAGE_PATH}?status=${result.ok ? "roles_updated" : result.error.code.toLowerCase()}`,
  );
}

function stringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}
