import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  getUser: vi.fn(),
  getClaims: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: dependencies.cookieSet })),
}));
vi.mock("../../../../lib/config/server-runtime", () => ({
  serverEnvironment: { supabaseSecretKey: "sb_secret_bootstrap-test" },
}));
vi.mock("../../../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: dependencies.getUser,
      getClaims: dependencies.getClaims,
    },
  })),
}));

import { verifyPasswordLinkMarker } from "../../../../lib/auth/password-link-marker";
import { POST } from "./route";

const recipientId = "20000000-0000-4000-8000-000000000002";
const recipientSessionId = "30000000-0000-4000-8000-000000000003";
const adminId = "10000000-0000-4000-8000-000000000001";
const adminSessionId = "40000000-0000-4000-8000-000000000004";

function request(
  token: string | null,
  mode: unknown = "invite",
  sameOrigin = true,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: sameOrigin ? "https://carnales.example" : "https://other.example",
    "sec-fetch-site": sameOrigin ? "same-origin" : "cross-site",
  };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new NextRequest(
    "https://carnales.example/auth/accept-invite/bootstrap",
    { method: "POST", headers, body: JSON.stringify({ mode }) },
  );
}

function validProviderResults(
  cookieUserId = recipientId,
  cookieSessionId = recipientSessionId,
) {
  dependencies.getUser.mockImplementation(async (token?: string) => ({
    data: { user: { id: token ? recipientId : cookieUserId } },
    error: null,
  }));
  dependencies.getClaims.mockImplementation(async (token?: string) => ({
    data: {
      claims: {
        sub: token ? recipientId : cookieUserId,
        session_id: token ? recipientSessionId : cookieSessionId,
      },
    },
    error: null,
  }));
}

describe("implicit password-link bootstrap", () => {
  beforeEach(() => {
    dependencies.cookieSet.mockReset();
    dependencies.getUser.mockReset();
    dependencies.getClaims.mockReset();
  });

  it.each(["invite", "recovery"] as const)(
    "binds a validated matching bearer/cookie %s session",
    async (mode) => {
      validProviderResults();
      const token = `synthetic.${randomUUID()}.credential`;

      const response = await POST(request(token, mode));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ status: "ready" });
      expect(dependencies.getUser.mock.calls).toEqual([[token], []]);
      expect(dependencies.getClaims.mock.calls).toEqual([[token], []]);
      const markerCall = dependencies.cookieSet.mock.calls.at(-1);
      expect(markerCall?.[0]).toBe("carnales-password-link");
      expect(markerCall?.[2]).toEqual(
        expect.objectContaining({
          httpOnly: true,
          sameSite: "lax",
          path: "/auth/accept-invite",
          maxAge: 600,
        }),
      );
      expect(
        verifyPasswordLinkMarker(markerCall?.[1], "sb_secret_bootstrap-test"),
      ).toEqual(
        expect.objectContaining({
          userId: recipientId,
          sessionId: recipientSessionId,
          mode,
        }),
      );
      expect(JSON.stringify(body)).not.toContain(token);
    },
  );

  it.each([
    ["missing bearer", request(null)],
    ["cross origin", request("synthetic.token.value", "invite", false)],
    ["unknown mode", request("synthetic.token.value", "administrator")],
  ])("rejects %s before signing a marker", async (_label, input) => {
    validProviderResults();
    const response = await POST(input);

    expect(response.status).not.toBe(200);
    expect(await response.json()).toEqual({ status: "unusable" });
    expect(dependencies.cookieSet).not.toHaveBeenCalledWith(
      "carnales-password-link",
      expect.not.stringMatching(/^$/u),
      expect.objectContaining({ maxAge: 600 }),
    );
  });

  it.each([
    [adminId, recipientSessionId],
    [recipientId, adminSessionId],
  ])(
    "rejects cookie identity/session mismatch (%s, %s)",
    async (cookieUserId, cookieSessionId) => {
      validProviderResults(cookieUserId, cookieSessionId);
      const response = await POST(request("synthetic.token.value"));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ status: "unusable" });
      expect(dependencies.cookieSet).toHaveBeenLastCalledWith(
        "carnales-password-link",
        "",
        expect.objectContaining({ maxAge: 0 }),
      );
    },
  );

  it("contains provider failures and returns no credential detail", async () => {
    dependencies.getUser.mockRejectedValue(
      new Error("private provider credential detail"),
    );
    const token = "synthetic.private.credential";
    const response = await POST(request(token));
    const body = await response.json();

    expect(body).toEqual({ status: "unusable" });
    expect(JSON.stringify(body)).not.toMatch(/private|provider|credential/u);
  });
});
