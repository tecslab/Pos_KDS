import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("inventory item administration UI", () => {
  it("guards the page and mutation with the dedicated persisted permission", async () => {
    const [page, actions] = await Promise.all([
      readFile(new URL("./page.tsx", import.meta.url), "utf8"),
      readFile(new URL("./actions.ts", import.meta.url), "utf8"),
    ]);
    expect(page).toContain('"administration.inventory.manage"');
    expect(actions).toContain('"administration.inventory.manage"');
    expect(page).not.toContain('requireServerPermission("inventory.view"');
  });

  it("exposes all item fields and makes stock explicitly read-only", async () => {
    const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    for (const name of [
      "name",
      "type",
      "unitOfMeasure",
      "minimumStockLevel",
      "isActive",
    ])
      expect(page).toContain(`name="${name}"`);
    for (const text of [
      "Ingrediente crudo",
      "Artículo producido",
      "Artículo de reventa",
      "Existencia actual",
      "no agrega, ajusta ni establece existencias",
      "El tipo y la unidad están protegidos",
    ])
      expect(page).toContain(text);
    expect(page).not.toContain('name="currentStock"');
    expect(page).toContain("min-h-12");
    expect(page).toContain("focus:ring-2");
  });
});
