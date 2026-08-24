import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("product category administration UI", () => {
  it("guards page and mutation with the exact persisted permission", async () => {
    const [page, actions] = await Promise.all([
      readFile(new URL("./page.tsx", import.meta.url), "utf8"),
      readFile(new URL("./actions.ts", import.meta.url), "utf8"),
    ]);
    expect(page).toContain('"administration.categories.manage"');
    expect(actions).toContain('"administration.categories.manage"');
  });

  it("exposes create, edit, reorder and active controls in accessible Spanish", async () => {
    const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    for (const name of ["name", "displayOrder", "isActive"])
      expect(page).toContain(`name="${name}"`);
    expect(page).toContain("Nueva categoría");
    expect(page).toContain("Guardar cambios");
    expect(page).toContain("Orden en el menú");
    expect(page).toContain("Categoría activa");
    expect(page).toContain("Activa");
    expect(page).toContain("Inactiva");
    expect(page).toContain("min-h-12");
    expect(page).toContain("focus:ring-2");
    expect(page).not.toMatch(
      /product forms|menu selection|precio|modificaci[oó]n/i,
    );
  });
});
