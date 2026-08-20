import "server-only";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "../supabase/server";
import { loginPath } from "./auth-paths";
import { readVerifiedSession, type VerifiedSession } from "./auth-session";

export async function requireAuthenticatedSession(
  returnTo: string = "/",
): Promise<VerifiedSession> {
  const session = await readVerifiedSession(await createServerSupabaseClient());

  if (session === null) {
    redirect(loginPath(returnTo));
  }

  return session;
}
