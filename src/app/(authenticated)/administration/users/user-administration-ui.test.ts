import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const permission = "administration.users.manage";

describe("administrator user management UI", () => {
  it("guards both the page and every mutation with persisted authorization", async () => {
    const [page, actions] = await Promise.all([
      readFile(new URL("./page.tsx", import.meta.url), "utf8"),
      readFile(new URL("./actions.ts", import.meta.url), "utf8"),
    ]);

    expect(page).toMatch(
      new RegExp(`requireServerPermission\\(\\s*${JSON.stringify(permission)}`),
    );
    expect(
      actions.match(
        new RegExp(
          `requireServerPermission\\(\\s*${JSON.stringify(permission)}`,
          "g",
        ),
      ),
    ).toHaveLength(3);
  });

  it("offers invitation, status, and reset operations without password or role inputs", async () => {
    const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

    expect(page).toContain("action={inviteUser}");
    expect(page).toContain("action={setUserActive}");
    expect(page).toContain("action={requestPasswordReset}");
    expect(page).not.toMatch(/type=["']password["']/i);
    expect(page).not.toMatch(/name=["']role/i);
    expect(page).toMatch(/md:grid-cols|sm:grid-cols/);
    expect(page).toContain('role={statusIsError ? "alert" : "status"}');
    expect(page).toContain("--status-critical");
  });
});
