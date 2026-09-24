import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { PasswordLinkClaims, PasswordLinkMode } from "./password-link";

const MARKER_VERSION = 1;
const KEY_CONTEXT = "carnales/password-link-binding/v1";
const MARKER_PURPOSE = "password-link";
export const PASSWORD_LINK_MARKER_COOKIE = "carnales-password-link";
export const PASSWORD_LINK_MARKER_TTL_SECONDS = 10 * 60;

type MarkerPayload = Readonly<{
  version: 1;
  purpose: typeof MARKER_PURPOSE;
  userId: string;
  sessionId: string;
  mode: PasswordLinkMode;
  issuedAt: number;
  expiresAt: number;
}>;

export function createPasswordLinkMarker(
  input: Readonly<{
    userId: string;
    sessionId: string;
    mode: PasswordLinkMode;
  }>,
  secret: string,
  now = Date.now(),
): string {
  const payload: MarkerPayload = Object.freeze({
    version: MARKER_VERSION,
    purpose: MARKER_PURPOSE,
    userId: input.userId,
    sessionId: input.sessionId,
    mode: input.mode,
    issuedAt: now,
    expiresAt: now + PASSWORD_LINK_MARKER_TTL_SECONDS * 1000,
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = sign(encodedPayload, secret).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyPasswordLinkMarker(
  marker: string,
  secret: string,
  now = Date.now(),
): PasswordLinkClaims | null {
  try {
    if (marker.length > 1024) return null;
    const segments = marker.split(".");
    if (segments.length !== 2) return null;
    const [encodedPayload, encodedSignature] = segments;
    if (
      !isCanonicalBase64Url(encodedPayload) ||
      !isCanonicalBase64Url(encodedSignature)
    ) {
      return null;
    }

    const candidate = Buffer.from(encodedSignature, "base64url");
    const expected = sign(encodedPayload, secret);
    if (
      candidate.length !== expected.length ||
      !timingSafeEqual(candidate, expected)
    ) {
      return null;
    }

    const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const value: unknown = JSON.parse(decoded);
    if (!isValidPayload(value, now)) return null;

    return Object.freeze({
      userId: value.userId,
      sessionId: value.sessionId,
      mode: value.mode,
      issuedAt: value.issuedAt,
      expiresAt: value.expiresAt,
    });
  } catch {
    return null;
  }
}

function sign(encodedPayload: string, secret: string): Buffer {
  const derivedKey = createHmac("sha256", secret).update(KEY_CONTEXT).digest();
  return createHmac("sha256", derivedKey).update(encodedPayload).digest();
}

function isCanonicalBase64Url(value: string): boolean {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  return Buffer.from(value, "base64url").toString("base64url") === value;
}

function isValidPayload(value: unknown, now: number): value is MarkerPayload {
  if (!isRecord(value)) return false;
  if (
    Object.keys(value).sort().join(",") !==
    "expiresAt,issuedAt,mode,purpose,sessionId,userId,version"
  ) {
    return false;
  }
  if (
    value.version !== MARKER_VERSION ||
    value.purpose !== MARKER_PURPOSE ||
    !isUuid(value.userId) ||
    !isUuid(value.sessionId) ||
    (value.mode !== "invite" && value.mode !== "recovery") ||
    typeof value.issuedAt !== "number" ||
    !Number.isSafeInteger(value.issuedAt) ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt)
  ) {
    return false;
  }
  return (
    value.issuedAt <= now + 5000 &&
    value.issuedAt >= now - PASSWORD_LINK_MARKER_TTL_SECONDS * 1000 &&
    value.expiresAt > now &&
    value.expiresAt ===
      value.issuedAt + PASSWORD_LINK_MARKER_TTL_SECONDS * 1000 &&
    value.expiresAt <= now + PASSWORD_LINK_MARKER_TTL_SECONDS * 1000
  );
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
