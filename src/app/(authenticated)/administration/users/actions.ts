"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createUserAdministrationService } from "@/lib/user-administration/server";

const PAGE_PATH = "/administration/users";

export async function inviteUser(formData: FormData): Promise<never> {
  const actor = await requireServerPermission(
    "administration.users.manage",
    PAGE_PATH,
  );
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  const redirectTo = origin
    ? new URL("/auth/accept-invite", origin).toString()
    : "";
  const result = await createUserAdministrationService().invite(actor.userId, {
    email: stringValue(formData.get("email")),
    displayName: stringValue(formData.get("displayName")),
    redirectTo,
  });
  redirect(statusPath(result.ok ? "invited" : result.error.code.toLowerCase()));
}

export async function setUserActive(formData: FormData): Promise<never> {
  const actor = await requireServerPermission(
    "administration.users.manage",
    PAGE_PATH,
  );
  const activeValue = formData.get("active");
  if (activeValue !== "true" && activeValue !== "false") {
    redirect(statusPath("invalid_input"));
  }
  const active = activeValue === "true";
  const result = await createUserAdministrationService().setActive(
    actor.userId,
    stringValue(formData.get("userId")),
    active,
  );
  redirect(
    statusPath(
      result.ok
        ? active
          ? "activated"
          : "deactivated"
        : result.error.code.toLowerCase(),
    ),
  );
}

export async function requestPasswordReset(formData: FormData): Promise<never> {
  const actor = await requireServerPermission(
    "administration.users.manage",
    PAGE_PATH,
  );
  const result = await createUserAdministrationService().requestPasswordReset(
    actor.userId,
    stringValue(formData.get("userId")),
  );
  redirect(
    statusPath(result.ok ? "reset_sent" : result.error.code.toLowerCase()),
  );
}

function stringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function statusPath(status: string): string {
  return `${PAGE_PATH}?status=${encodeURIComponent(status)}`;
}
