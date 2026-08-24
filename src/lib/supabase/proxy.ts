import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import {
  ACCESS_DENIED_PATH,
  loginPath,
  LOGIN_PATH,
  safeLocalPath,
} from "../auth";
import { parsePublicEnvironment } from "../config/environment";
import { assertTlsVerificationEnabled } from "../config/tls-security";

type CookieToSet = Readonly<{
  name: string;
  value: string;
  options?: Record<string, unknown>;
}>;

export type ProxyCookieBridge = Readonly<{
  getAll(): ReturnType<NextRequest["cookies"]["getAll"]>;
  setAll(cookies: readonly CookieToSet[]): void;
}>;

export type ProxyAuthClientFactory = (cookies: ProxyCookieBridge) => {
  auth: {
    getClaims(): Promise<{
      data: { claims: { sub?: unknown } } | null;
      error: unknown | null;
    }>;
  };
};

export async function routeAuthenticatedRequest(
  request: NextRequest,
  clientFactory: ProxyAuthClientFactory = createProxyClient,
): Promise<NextResponse> {
  assertTlsVerificationEnabled(process.env.NODE_TLS_REJECT_UNAUTHORIZED);
  let response = NextResponse.next({ request });

  const cookieBridge: ProxyCookieBridge = {
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet) => {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }

      response = NextResponse.next({ request });

      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }
    },
  };

  let authenticated = false;

  try {
    const { data, error } = await clientFactory(cookieBridge).auth.getClaims();
    authenticated = error === null && isNonblank(data?.claims.sub);
  } catch {
    authenticated = false;
  }

  const isLogin = request.nextUrl.pathname === LOGIN_PATH;
  const isPublicAuthRoute =
    isLogin || request.nextUrl.pathname === ACCESS_DENIED_PATH;

  if (!authenticated && !isPublicAuthRoute) {
    return redirectWithCookies(
      request,
      loginPath(`${request.nextUrl.pathname}${request.nextUrl.search}`),
      response,
    );
  }

  if (authenticated && isLogin) {
    return redirectWithCookies(
      request,
      safeLocalPath(request.nextUrl.searchParams.get("next")),
      response,
    );
  }

  return response;
}

function createProxyClient(cookies: ProxyCookieBridge) {
  const environment = parsePublicEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  return createServerClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
    { cookies },
  );
}

function redirectWithCookies(
  request: NextRequest,
  path: string,
  source: NextResponse,
): NextResponse {
  const destination = NextResponse.redirect(new URL(path, request.url));

  for (const cookie of source.cookies.getAll()) {
    destination.cookies.set(cookie);
  }

  return destination;
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
