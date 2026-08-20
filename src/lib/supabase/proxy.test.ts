import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import {
  routeAuthenticatedRequest,
  type ProxyAuthClientFactory,
} from "./proxy";

function factory(
  authenticated: boolean,
  refresh = false,
): ProxyAuthClientFactory {
  return (cookies) => ({
    auth: {
      getClaims: vi.fn(async () => {
        if (refresh) {
          cookies.setAll([
            {
              name: "sb-auth-token",
              value: "refreshed-cookie",
              options: { httpOnly: true, sameSite: "lax" },
            },
          ]);
        }

        return authenticated
          ? { data: { claims: { sub: "user-1" } }, error: null }
          : { data: null, error: null };
      }),
    },
  });
}

describe("Supabase auth proxy", () => {
  it("redirects an unauthenticated protected request to login with local next", async () => {
    const request = new NextRequest(
      "https://carnales.example/orders?status=ready",
    );

    const response = await routeAuthenticatedRequest(request, factory(false));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://carnales.example/login?next=%2Forders%3Fstatus%3Dready",
    );
  });

  it("keeps login public while failing closed", async () => {
    const throwingFactory: ProxyAuthClientFactory = () => ({
      auth: {
        getClaims: vi.fn().mockRejectedValue(new Error("verification failed")),
      },
    });

    const response = await routeAuthenticatedRequest(
      new NextRequest("https://carnales.example/login"),
      throwingFactory,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects an authenticated login request to a safe local destination", async () => {
    const response = await routeAuthenticatedRequest(
      new NextRequest(
        "https://carnales.example/login?next=%2Fadmin%3Ftab%3Dusers",
      ),
      factory(true),
    );

    expect(response.headers.get("location")).toBe(
      "https://carnales.example/admin?tab=users",
    );
  });

  it("propagates refreshed auth cookies to normal and redirect responses", async () => {
    const normal = await routeAuthenticatedRequest(
      new NextRequest("https://carnales.example/orders"),
      factory(true, true),
    );
    const redirected = await routeAuthenticatedRequest(
      new NextRequest("https://carnales.example/orders"),
      factory(false, true),
    );

    expect(normal.cookies.get("sb-auth-token")?.value).toBe("refreshed-cookie");
    expect(redirected.cookies.get("sb-auth-token")?.value).toBe(
      "refreshed-cookie",
    );
  });
});
