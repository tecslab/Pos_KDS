import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPasswordLinkMarker,
  PASSWORD_LINK_MARKER_TTL_SECONDS,
  verifyPasswordLinkMarker,
} from "./password-link-marker";

const now = Date.parse("2026-09-24T04:00:00.000Z");
const secret = "sb_secret_test-value-never-logged";
const input = {
  userId: "20000000-0000-4000-8000-000000000002",
  sessionId: "30000000-0000-4000-8000-000000000003",
  mode: "recovery" as const,
};

describe("password-link marker", () => {
  it("round trips a short-lived recipient binding", () => {
    const marker = createPasswordLinkMarker(input, secret, now);

    const result = verifyPasswordLinkMarker(marker, secret, now);

    expect(result).toEqual({
      ...input,
      issuedAt: now,
      expiresAt: now + PASSWORD_LINK_MARKER_TTL_SECONDS * 1000,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects any payload or signature change", () => {
    const marker = createPasswordLinkMarker(input, secret, now);
    const [payload, signature] = marker.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const changedPayload = Buffer.from(
      JSON.stringify({ ...decoded, mode: "invite" }),
    ).toString("base64url");

    expect(
      verifyPasswordLinkMarker(`${changedPayload}.${signature}`, secret, now),
    ).toBeNull();
    expect(
      verifyPasswordLinkMarker(`${payload}.${signature.slice(1)}`, secret, now),
    ).toBeNull();
    expect(
      verifyPasswordLinkMarker("plain-forged-value", secret, now),
    ).toBeNull();
  });

  it.each([
    ["userId", "40000000-0000-4000-8000-000000000004"],
    ["sessionId", "50000000-0000-4000-8000-000000000005"],
    ["purpose", "different-purpose"],
    ["version", 2],
  ])("rejects a changed signed %s claim", (field, replacement) => {
    const marker = createPasswordLinkMarker(input, secret, now);
    const [payload, signature] = marker.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const changedPayload = Buffer.from(
      JSON.stringify({ ...decoded, [field]: replacement }),
    ).toString("base64url");

    expect(
      verifyPasswordLinkMarker(`${changedPayload}.${signature}`, secret, now),
    ).toBeNull();
  });

  it("rejects expired and excessive-lifetime signed markers", () => {
    const marker = createPasswordLinkMarker(input, secret, now);
    const futureMarker = createPasswordLinkMarker(input, secret, now + 1);

    expect(
      verifyPasswordLinkMarker(
        marker,
        secret,
        now + PASSWORD_LINK_MARKER_TTL_SECONDS * 1000,
      ),
    ).toBeNull();
    expect(verifyPasswordLinkMarker(futureMarker, secret, now)).toBeNull();
  });

  it.each(["", ".", "a.b.c", "%%%%.%%%%", "a."])(
    "fails closed for malformed marker %j",
    (marker) => {
      expect(verifyPasswordLinkMarker(marker, secret, now)).toBeNull();
    },
  );
});
