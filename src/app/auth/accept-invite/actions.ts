"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { updatePasswordFromLink } from "@/lib/auth/password-link";
import {
  PASSWORD_LINK_MARKER_COOKIE,
  verifyPasswordLinkMarker,
} from "@/lib/auth/password-link-marker";
import { serverEnvironment } from "@/lib/config/server-runtime";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const PAGE_PATH = "/auth/accept-invite";

export async function updatePassword(formData: FormData): Promise<never> {
  const cookieStore = await cookies();
  const marker = cookieStore.get(PASSWORD_LINK_MARKER_COOKIE)?.value ?? null;
  const password = formData.get("password");
  const client = await createServerSupabaseClient();
  const markerClaims = marker
    ? verifyPasswordLinkMarker(marker, serverEnvironment.supabaseSecretKey)
    : null;
  const result = await updatePasswordFromLink(
    {
      marker,
      password: typeof password === "string" ? password : null,
    },
    (value) =>
      verifyPasswordLinkMarker(value, serverEnvironment.supabaseSecretKey),
    client.auth,
  );

  if (result.code === "invalid_password") {
    redirect(statusPath("invalid_password", markerClaims?.mode));
  }

  clearMarker(cookieStore);
  if (result.code === "updated") {
    try {
      await client.auth.signOut({ scope: "local" });
    } catch {
      // The password update succeeded; Supabase still owns session cleanup.
    }
    redirect("/login?status=password_updated");
  }
  redirect(statusPath(result.code, markerClaims?.mode));
}

function statusPath(status: string, mode?: "invite" | "recovery") {
  const params = new URLSearchParams({ status });
  if (mode !== undefined) params.set("mode", mode);
  return `${PAGE_PATH}?${params.toString()}`;
}

function clearMarker(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  cookieStore.set(PASSWORD_LINK_MARKER_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: PAGE_PATH,
    maxAge: 0,
  });
}
