import "server-only";

import {
  AuthorizationService,
  type AuthorizedEmployeeContext,
} from "../../application";
import { err, ok, type Result } from "../../domain";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { createServerSupabaseClient } from "../supabase/server";
import { readVerifiedSession } from "./auth-session";

export type ApiAuthorizationError = Readonly<{
  code: "AUTHENTICATION_REQUIRED" | "UNAUTHORIZED";
}>;

export async function authorizeApiPermission(
  requiredPermission: string,
): Promise<Result<AuthorizedEmployeeContext, ApiAuthorizationError>> {
  let client;
  try {
    client = await createServerSupabaseClient();
  } catch {
    return denied("AUTHENTICATION_REQUIRED");
  }

  const session = await readVerifiedSession(client);
  if (session === null) return denied("AUTHENTICATION_REQUIRED");

  try {
    const authorization = await new AuthorizationService(
      new SupabaseAuthorizationProfileReader(client),
    ).authorize(session.userId, requiredPermission);
    return authorization.ok ? ok(authorization.value) : denied("UNAUTHORIZED");
  } catch {
    return denied("UNAUTHORIZED");
  }
}

function denied(code: ApiAuthorizationError["code"]) {
  return err(Object.freeze({ code }));
}
