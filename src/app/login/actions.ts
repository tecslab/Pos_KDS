"use server";

import { redirect } from "next/navigation";

import { authenticatePassword, endLocalSession, loginPath } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { operationalTelemetry } from "@/lib/observability/recorder";

export async function signIn(formData: FormData): Promise<never> {
  const client = await createServerSupabaseClient();
  const result = await authenticatePassword(
    formData,
    client.auth,
    operationalTelemetry,
  );

  redirect(result.ok ? result.nextPath : loginPath(result.nextPath, true));
}

export async function signOut(): Promise<never> {
  const client = await createServerSupabaseClient();
  const signedOut = await endLocalSession(client.auth);

  redirect(signedOut ? "/login" : "/?session_error=sign_out_failed");
}
