import "server-only";

import { redirect } from "next/navigation";

import {
  AuthorizationService,
  type AuthorizationProfileReader,
  type AuthorizedEmployeeContext,
} from "../../application";
import { unauthorizedError } from "../../domain";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { createServerSupabaseClient } from "../supabase/server";
import { loginPath } from "./auth-paths";
import { readVerifiedSession } from "./auth-session";

/**
 * Server-only authentication and persisted-permission boundary. The verified
 * JWT contributes only its subject; roles and permissions always come from the
 * application database.
 */
export async function requireServerPermission(
  requiredPermission: string,
  returnTo: string = "/",
): Promise<AuthorizedEmployeeContext> {
  const { service, userId } = await createAuthorizationRequest(returnTo);
  const authorization = await service.authorize(userId, requiredPermission);

  if (!authorization.ok) {
    throw unauthorizedError();
  }

  return authorization.value;
}

export async function requireServerAuthorizationContext(
  returnTo: string = "/",
): Promise<AuthorizedEmployeeContext> {
  const { service, userId } = await createAuthorizationRequest(returnTo);
  const authorization = await service.readContext(userId);

  if (!authorization.ok) {
    throw unauthorizedError();
  }

  return authorization.value;
}

async function createAuthorizationRequest(returnTo: string) {
  let session = null;

  try {
    session = await readVerifiedSession(await createServerSupabaseClient());
  } catch {
    session = null;
  }

  if (session === null) {
    redirect(loginPath(returnTo));
  }

  let profileReader: AuthorizationProfileReader;

  try {
    profileReader = new SupabaseAuthorizationProfileReader(
      await createServerSupabaseClient(),
    );
  } catch {
    throw unauthorizedError();
  }

  return Object.freeze({
    service: new AuthorizationService(profileReader),
    userId: session.userId,
  });
}
