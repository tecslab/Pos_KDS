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
  it("records safe auth failure without URL or cookies", async () => {
    const record = vi.fn();
    const request = new NextRequest(
      "https://carnales.example/orders?customer=private",
      { headers: { cookie: "token=secret" } },
    );

    const response = await routeAuthenticatedRequest(request, factory(false), {
      record,
    });

    expect(response.status).toBe(307);
    expect(record.mock.calls.map(([entry]) => entry)).toEqual([
      {
        event: "authentication.failed",
        reason: "MISSING_OR_INVALID_SESSION",
      },
    ]);
    expect(JSON.stringify(record.mock.calls)).not.toContain("customer");
    expect(JSON.stringify(record.mock.calls)).not.toContain("secret");
  });

  it("returns a generic 500 and records a classified unexpected request exception", async () => {
    const record = vi.fn();
    const original = new NextRequest("https://carnales.example/orders");
    const malformed = new Proxy(original, {
      get(target, property) {
        if (property === "nextUrl") {
          throw Object.assign(new Error("private request details"), {
            code: "ECONNRESET",
          });
        }
        return Reflect.get(target, property, target);
      },
    });

    const response = await routeAuthenticatedRequest(malformed, factory(true), {
      record,
    });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(record.mock.calls.map(([entry]) => entry)).toEqual([
      {
        event: "exception.unexpected",
        boundary: "request",
        errorClass: "NETWORK",
      },
    ]);
    expect(JSON.stringify(record.mock.calls)).not.toContain("private request");
  });

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

  it("keeps the access-denied explanation public while failing closed", async () => {
    const response = await routeAuthenticatedRequest(
      new NextRequest("https://carnales.example/access-denied"),
      factory(false),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps the password-link page public", async () => {
    const response = await routeAuthenticatedRequest(
      new NextRequest("https://carnales.example/auth/accept-invite"),
      factory(false),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps the bootstrap protected without a recipient session", async () => {
    const response = await routeAuthenticatedRequest(
      new NextRequest("https://carnales.example/auth/accept-invite/bootstrap"),
      factory(false),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?next=");
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
