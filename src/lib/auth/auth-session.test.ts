import { describe, expect, it, vi } from "vitest";

import { readVerifiedSession, type ClaimsAuthClient } from "./auth-session";

function client(
  result: Awaited<ReturnType<ClaimsAuthClient["auth"]["getClaims"]>>,
): ClaimsAuthClient {
  return { auth: { getClaims: vi.fn().mockResolvedValue(result) } };
}

describe("readVerifiedSession", () => {
  it("returns an immutable identity only from verified claims", async () => {
    const session = await readVerifiedSession(
      client({
        data: { claims: { sub: "user-1", email: "user@example.com" } },
        error: null,
      }),
    );

    expect(session).toEqual({
      userId: "user-1",
      email: "user@example.com",
    });
    expect(Object.isFrozen(session)).toBe(true);
  });

  it.each([
    { data: null, error: null },
    { data: { claims: { sub: " " } }, error: null },
    { data: { claims: { sub: "user-1" } }, error: new Error("invalid JWT") },
  ])("fails closed for missing or invalid claims", async (result) => {
    await expect(readVerifiedSession(client(result))).resolves.toBeNull();
  });

  it("fails closed when verification throws", async () => {
    const getClaims = vi.fn().mockRejectedValue(new Error("provider detail"));

    await expect(
      readVerifiedSession({ auth: { getClaims } }),
    ).resolves.toBeNull();
  });
});
