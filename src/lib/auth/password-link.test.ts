import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildPasswordLinkCallbackUrl,
  classifyImplicitPasswordLink,
  consumeImplicitPasswordLink,
  updatePasswordFromLink,
  validatePasswordLinkSession,
  type ImplicitPasswordLinkAuth,
  type PasswordLinkClaims,
} from "./password-link";

const adminId = "10000000-0000-4000-8000-000000000001";
const recipientId = "20000000-0000-4000-8000-000000000002";
const recipientSessionId = "30000000-0000-4000-8000-000000000003";
const adminSessionId = "40000000-0000-4000-8000-000000000004";
type TestImplicitSession = Readonly<{
  access_token: string;
  user: { id: string };
}>;
const claims: PasswordLinkClaims = Object.freeze({
  userId: recipientId,
  sessionId: recipientSessionId,
  mode: "invite",
  issuedAt: Date.now(),
  expiresAt: Date.now() + 60_000,
});

function implicitUrl(mode: "invite" | "recovery", type = mode): URL {
  const fragment = new URLSearchParams({
    access_token: `access-${randomUUID()}`,
    refresh_token: `refresh-${randomUUID()}`,
    expires_in: "3600",
    expires_at: "1790200000",
    token_type: "bearer",
    type,
  });
  return new URL(
    `https://carnales.example/auth/accept-invite?mode=${mode}#${fragment}`,
  );
}

function updateService(userId = recipientId, sessionId = recipientSessionId) {
  return {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    }),
    getClaims: vi.fn().mockResolvedValue({
      data: { claims: { sub: userId, session_id: sessionId } },
      error: null,
    }),
    updateUser: vi.fn().mockResolvedValue({ error: null }),
  };
}

describe("implicit password-link flow", () => {
  it.each([
    ["invite", "SIGNED_IN"],
    ["recovery", "PASSWORD_RECOVERY"],
  ] as const)("classifies a complete %s fragment", (mode, expectedEvent) => {
    expect(classifyImplicitPasswordLink(implicitUrl(mode))).toEqual({
      mode,
      expectedEvent,
    });
  });

  it.each([
    new URL("https://carnales.example/auth/accept-invite?mode=invite"),
    new URL(
      "https://carnales.example/auth/accept-invite?mode=invite&mode=recovery",
    ),
    new URL(
      "https://carnales.example/auth/accept-invite?mode=invite&access_token=query-value",
    ),
    implicitUrl("invite", "recovery"),
    implicitUrl("recovery", "invite"),
    new URL("https://carnales.example/other?mode=invite#type=invite"),
  ])("rejects a bare, ambiguous, or mismatched callback", (url) => {
    expect(classifyImplicitPasswordLink(url)).toBeNull();
  });

  it("rejects a partial fragment", () => {
    const url = implicitUrl("invite");
    const fragment = new URLSearchParams(url.hash.slice(1));
    fragment.delete("refresh_token");
    url.hash = fragment.toString();

    expect(classifyImplicitPasswordLink(url)).toBeNull();
  });

  it.each([
    ["invite", "SIGNED_IN"],
    ["recovery", "PASSWORD_RECOVERY"],
  ] as const)(
    "waits for the exact %s event, scrubs the fragment, and bootstraps once",
    async (mode, event) => {
      const url = implicitUrl(mode);
      const classification = classifyImplicitPasswordLink(url);
      const accessToken = new URLSearchParams(url.hash.slice(1)).get(
        "access_token",
      )!;
      const session = {
        access_token: accessToken,
        user: { id: recipientId },
      };
      let callback:
        ((event: string, session: TestImplicitSession) => void) | null = null;
      const unsubscribe = vi.fn();
      const auth: ImplicitPasswordLinkAuth = {
        onAuthStateChange: vi.fn((listener) => {
          callback = listener as typeof callback;
          return { data: { subscription: { unsubscribe } } };
        }),
        getSession: vi.fn(async () => {
          callback?.(event, session);
          return { data: { session }, error: null };
        }),
      };
      const order: string[] = [];
      const bootstrap = vi.fn(async (token: string, receivedMode: string) => {
        order.push("bootstrap");
        expect(token).toBe(accessToken);
        expect(receivedMode).toBe(mode);
        return true;
      });

      const result = await consumeImplicitPasswordLink(classification, auth, {
        scrubFragment: () => order.push("scrub"),
        bootstrap,
      });

      expect(result).toEqual({ code: "ready", mode });
      expect(order.indexOf("scrub")).toBeLessThan(order.indexOf("bootstrap"));
      expect(bootstrap).toHaveBeenCalledOnce();
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(JSON.stringify(result)).not.toContain(accessToken);
    },
  );

  it("does nothing with an active admin session on a bare accept URL", async () => {
    const auth = {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: { access_token: "admin-token", user: { id: adminId } },
        },
        error: null,
      }),
    } as unknown as ImplicitPasswordLinkAuth;
    const bootstrap = vi.fn();

    const result = await consumeImplicitPasswordLink(null, auth, {
      scrubFragment: vi.fn(),
      bootstrap,
    });

    expect(result).toEqual({ code: "missing", mode: null });
    expect(auth.onAuthStateChange).not.toHaveBeenCalled();
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("rejects the wrong event and never bootstraps", async () => {
    const url = implicitUrl("recovery");
    const session = {
      access_token: "synthetic-access",
      user: { id: recipientId },
    };
    let callback:
      ((event: string, session: TestImplicitSession) => void) | null = null;
    const auth: ImplicitPasswordLinkAuth = {
      onAuthStateChange: (listener) => {
        callback = listener as typeof callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: vi.fn(async () => {
        callback?.("SIGNED_IN", session);
        return { data: { session }, error: null };
      }),
    };
    const bootstrap = vi.fn();

    const result = await consumeImplicitPasswordLink(
      classifyImplicitPasswordLink(url),
      auth,
      {
        scrubFragment: vi.fn(),
        bootstrap,
        timeoutMilliseconds: 1,
      },
    );

    expect(result).toEqual({ code: "expired_or_invalid", mode: "recovery" });
    expect(bootstrap).not.toHaveBeenCalled();
  });
});

describe("guarded password update", () => {
  it("never updates an existing administrator when the marker is missing", async () => {
    const service = updateService(adminId, adminSessionId);
    const result = await updatePasswordFromLink(
      { marker: null, password: "employee-password" },
      () => null,
      service,
    );
    expect(result).toEqual({ code: "unusable" });
    expect(service.getUser).not.toHaveBeenCalled();
    expect(service.getClaims).not.toHaveBeenCalled();
    expect(service.updateUser).not.toHaveBeenCalled();
  });

  it("rejects forged markers before reading the active session", async () => {
    const service = updateService(adminId, adminSessionId);
    const result = await updatePasswordFromLink(
      { marker: "forged.marker", password: "employee-password" },
      () => null,
      service,
    );
    expect(result).toEqual({ code: "unusable" });
    expect(service.getUser).not.toHaveBeenCalled();
    expect(service.getClaims).not.toHaveBeenCalled();
    expect(service.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    [adminId, recipientSessionId],
    [recipientId, adminSessionId],
  ])(
    "rejects user or session mismatch before update",
    async (userId, sessionId) => {
      const service = updateService(userId, sessionId);
      const result = await updatePasswordFromLink(
        { marker: "authentic-marker", password: "employee-password" },
        () => claims,
        service,
      );
      expect(result).toEqual({ code: "unusable" });
      expect(service.updateUser).not.toHaveBeenCalled();
    },
  );

  it("updates only the bound recipient session", async () => {
    const service = updateService();
    const result = await updatePasswordFromLink(
      { marker: "authentic-marker", password: "employee-password" },
      () => claims,
      service,
    );
    expect(result).toEqual({ code: "updated" });
    expect(service.getUser).toHaveBeenCalledOnce();
    expect(service.getClaims).toHaveBeenCalledOnce();
    expect(service.updateUser).toHaveBeenCalledWith({
      password: "employee-password",
    });
  });

  it("validates form readiness against both user and session", async () => {
    await expect(
      validatePasswordLinkSession("marker", () => claims, updateService()),
    ).resolves.toEqual(claims);
    await expect(
      validatePasswordLinkSession(
        "marker",
        () => claims,
        updateService(recipientId, adminSessionId),
      ),
    ).resolves.toBeNull();
  });
});

describe("password-link dispatch target", () => {
  it("constructs direct implicit invite and recovery targets", () => {
    expect(
      buildPasswordLinkCallbackUrl("https://carnales.example", "invite"),
    ).toBe("https://carnales.example/auth/accept-invite?mode=invite");
    expect(
      buildPasswordLinkCallbackUrl("https://carnales.example", "recovery"),
    ).toBe("https://carnales.example/auth/accept-invite?mode=recovery");
    expect(buildPasswordLinkCallbackUrl(null, "invite")).toBeNull();
  });
});
