import { describe, expect, it } from "vitest";

import { loginPath, safeLocalPath } from "./auth-paths";

describe("auth return paths", () => {
  it.each([
    ["/", "/"],
    ["/orders?status=ready#top", "/orders?status=ready#top"],
    ["  /admin/users  ", "/admin/users"],
  ])("accepts the local path %s", (value, expected) => {
    expect(safeLocalPath(value)).toBe(expected);
  });

  it.each([
    "https://attacker.example/path",
    "//attacker.example/path",
    "/\\attacker.example/path",
    "javascript:alert(1)",
    "/login?next=/orders",
    "/access-denied",
    "",
    null,
  ])("rejects unsafe return path %s", (value) => {
    expect(safeLocalPath(value)).toBe("/");
  });

  it("builds an encoded local login return path with a generic error", () => {
    expect(loginPath("/orders?tab=ready", true)).toBe(
      "/login?next=%2Forders%3Ftab%3Dready&error=authentication_failed",
    );
    expect(loginPath("https://attacker.example", false)).toBe("/login");
  });
});
