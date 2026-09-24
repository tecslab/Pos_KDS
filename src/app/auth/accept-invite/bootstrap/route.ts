import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { parsePasswordLinkMode } from "../../../../lib/auth/password-link";
import {
  createPasswordLinkMarker,
  PASSWORD_LINK_MARKER_COOKIE,
  PASSWORD_LINK_MARKER_TTL_SECONDS,
} from "../../../../lib/auth/password-link-marker";
import { serverEnvironment } from "../../../../lib/config/server-runtime";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

const COOKIE_PATH = "/auth/accept-invite";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  clearMarker(cookieStore);

  try {
    if (!isSameOrigin(request)) return fixedResponse("unusable", 403);
    const token = bearerToken(request.headers.get("authorization"));
    if (token === null) return fixedResponse("unusable", 401);
    const body: unknown = await request.json();
    const mode =
      isRecord(body) && Object.keys(body).length === 1
        ? parsePasswordLinkMode(body.mode)
        : null;
    if (mode === null) return fixedResponse("unusable", 400);

    const client = await createServerSupabaseClient();
    const [bearerUser, bearerClaims, cookieUser, cookieClaims] =
      await Promise.all([
        client.auth.getUser(token),
        client.auth.getClaims(token),
        client.auth.getUser(),
        client.auth.getClaims(),
      ]);
    const bearerUserId = bearerUser.data.user?.id;
    const bearerPayload = bearerClaims.data?.claims;
    const cookieUserId = cookieUser.data.user?.id;
    const cookiePayload = cookieClaims.data?.claims;
    if (
      bearerUser.error !== null ||
      bearerClaims.error !== null ||
      cookieUser.error !== null ||
      cookieClaims.error !== null ||
      !isUuid(bearerUserId) ||
      bearerPayload?.sub !== bearerUserId ||
      !isUuid(bearerPayload.session_id) ||
      cookieUserId !== bearerUserId ||
      cookiePayload?.sub !== cookieUserId ||
      cookiePayload.session_id !== bearerPayload.session_id
    ) {
      return fixedResponse("unusable", 401);
    }

    const marker = createPasswordLinkMarker(
      {
        userId: bearerUserId,
        sessionId: bearerPayload.session_id,
        mode,
      },
      serverEnvironment.supabaseSecretKey,
    );
    cookieStore.set(PASSWORD_LINK_MARKER_COOKIE, marker, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: COOKIE_PATH,
      maxAge: PASSWORD_LINK_MARKER_TTL_SECONDS,
    });
    return fixedResponse("ready", 200);
  } catch {
    clearMarker(cookieStore);
    return fixedResponse("unusable", 400);
  }
}

function isSameOrigin(request: NextRequest): boolean {
  return (
    request.headers.get("origin") === request.nextUrl.origin &&
    request.headers.get("sec-fetch-site") === "same-origin"
  );
}

function bearerToken(value: string | null): string | null {
  if (value === null || value.length > 8192) return null;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(value);
  return match?.[1] ?? null;
}

function fixedResponse(status: "ready" | "unusable", httpStatus: number) {
  return NextResponse.json(
    { status },
    { status: httpStatus, headers: { "Cache-Control": "no-store" } },
  );
}

function clearMarker(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  cookieStore.set(PASSWORD_LINK_MARKER_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: COOKIE_PATH,
    maxAge: 0,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
