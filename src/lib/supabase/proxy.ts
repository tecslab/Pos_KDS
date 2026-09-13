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
import {
  classifyTelemetryError,
  type OperationalTelemetryRecorder,
} from "../../application";
import { operationalTelemetry } from "../observability/recorder";

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
  recorder: OperationalTelemetryRecorder = operationalTelemetry,
): Promise<NextResponse> {
  try {
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
    let authFailureReason: "MISSING_OR_INVALID_SESSION" | "PROVIDER_FAILURE" =
      "MISSING_OR_INVALID_SESSION";

    try {
      const { data, error } =
        await clientFactory(cookieBridge).auth.getClaims();
      authenticated = error === null && isNonblank(data?.claims.sub);
      authFailureReason =
        error === null ? "MISSING_OR_INVALID_SESSION" : "PROVIDER_FAILURE";
    } catch {
      authenticated = false;
      authFailureReason = "PROVIDER_FAILURE";
    }

    const isLogin = request.nextUrl.pathname === LOGIN_PATH;
    const isPublicAuthRoute =
      isLogin || request.nextUrl.pathname === ACCESS_DENIED_PATH;

    if (!authenticated && !isPublicAuthRoute) {
      safelyRecord(recorder, {
        event: "authentication.failed",
        reason: authFailureReason,
      });
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
  } catch (error) {
    safelyRecord(recorder, {
      event: "exception.unexpected",
      boundary: "request",
      errorClass: classifyTelemetryError(error),
    });
    return new NextResponse(null, { status: 500 });
  }
}

function safelyRecord(
  recorder: OperationalTelemetryRecorder,
  event: unknown,
): void {
  try {
    recorder.record(event);
  } catch {
    // Custom telemetry implementations cannot affect request handling.
  }
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
