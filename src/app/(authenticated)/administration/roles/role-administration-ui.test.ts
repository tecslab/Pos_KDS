import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("role assignment and permission inspection UI", () => {
  it("server-authorizes the page and mutation", async () => {
    const [page, actions] = await Promise.all([
      readFile(new URL("./page.tsx", import.meta.url), "utf8"),
      readFile(new URL("./actions.ts", import.meta.url), "utf8"),
    ]);
    expect(page).toContain('"administration.users.manage"');
    expect(actions).toContain('"administration.users.manage"');
    expect(actions).toContain("requireServerPermission");
  });

  it("submits only role identifiers and renders inherited permissions read-only", async () => {
    const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(page).toContain('name="roleId"');
    expect(page).not.toMatch(/name=["']permission/i);
    expect(page).toContain("Permisos heredados por función");
    expect(page).toMatch(/no se\s+otorgan directamente/);
    expect(page).not.toContain('name="displayName"');
    expect(page).toContain("min-h-12");
    expect(page).toMatch(/sm:grid-cols|md:grid-cols|lg:grid-cols/);
  });
});
