"use client";

import { createClient } from "@supabase/supabase-js";

import { classifyImplicitPasswordLink } from "../auth/password-link";
import { publicEnvironment } from "../config/runtime";

const BASE64_PREFIX = "base64-";
const MAX_COOKIE_CHUNK_SIZE = 3180;
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** A dedicated, non-singleton Auth client for admin-issued implicit links. */
export function createImplicitPasswordLinkClient() {
  return createClient(
    publicEnvironment.supabaseUrl,
    publicEnvironment.supabasePublishableKey,
    {
      auth: {
        flowType: "implicit",
        detectSessionInUrl: (url) => classifyImplicitPasswordLink(url) !== null,
        persistSession: true,
        autoRefreshToken: true,
        storage: createSsrCompatibleBrowserStorage(),
      },
    },
  );
}

function createSsrCompatibleBrowserStorage() {
  return {
    isServer: false,
    async getItem(key: string): Promise<string | null> {
      const cookies = readCookies();
      const encoded =
        cookies.get(key) ?? combineNumberedChunks(cookies, key) ?? null;
      if (encoded === null) return null;
      if (!encoded.startsWith(BASE64_PREFIX)) return encoded;
      try {
        const decoded = decodeBase64Url(encoded.slice(BASE64_PREFIX.length));
        JSON.parse(decoded);
        return decoded;
      } catch {
        return null;
      }
    },
    async setItem(key: string, value: string): Promise<void> {
      clearCookieChunks(key);
      const encoded = `${BASE64_PREFIX}${encodeBase64Url(value)}`;
      const chunks = splitCookieValue(encoded);
      for (let index = 0; index < chunks.length; index += 1) {
        writeCookie(
          chunks.length === 1 ? key : `${key}.${index}`,
          chunks[index],
        );
      }
    },
    async removeItem(key: string): Promise<void> {
      clearCookieChunks(key);
    },
  };
}

function readCookies(): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of document.cookie.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const name = decodeURIComponent(item.slice(0, separator).trim());
    const value = decodeURIComponent(item.slice(separator + 1).trim());
    result.set(name, value);
  }
  return result;
}

function combineNumberedChunks(
  cookies: ReadonlyMap<string, string>,
  key: string,
): string | null {
  const chunks: string[] = [];
  for (let index = 0; ; index += 1) {
    const chunk = cookies.get(`${key}.${index}`);
    if (chunk === undefined) break;
    chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks.join("") : null;
}

function splitCookieValue(value: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += MAX_COOKIE_CHUNK_SIZE) {
    chunks.push(value.slice(offset, offset + MAX_COOKIE_CHUNK_SIZE));
  }
  return chunks;
}

function clearCookieChunks(key: string) {
  for (const name of readCookies().keys()) {
    if (
      name === key ||
      new RegExp(`^${escapeRegExp(key)}\\.\\d+$`).test(name)
    ) {
      writeCookie(name, "", 0);
    }
  }
}

function writeCookie(
  name: string,
  value: string,
  maxAge = COOKIE_MAX_AGE_SECONDS,
) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
