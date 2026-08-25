import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("recipe administration UI", () => {
  it("guards page and mutation with recipe-edit permission", async () => {
    const [page, actions] = await Promise.all([
      readFile(new URL("./page.tsx", import.meta.url), "utf8"),
      readFile(new URL("./actions.ts", import.meta.url), "utf8"),
    ]);
    expect(page).toContain('"production.recipes.edit"');
    expect(actions).toContain('"production.recipes.edit"');
  });

  it("exposes versioned composition without production execution controls", async () => {
    const [page, editor] = await Promise.all([
      readFile(new URL("./page.tsx", import.meta.url), "utf8"),
      readFile(new URL("./recipe-editor.tsx", import.meta.url), "utf8"),
    ]);
    for (const name of [
      "restaurantId",
      "productId",
      "outputInventoryItemId",
      "name",
      "producedQuantity",
      "ingredientInventoryItemId",
      "ingredientRequiredQuantity",
      "isActive",
    ])
      expect(editor).toContain(`name="${name}"`);
    expect(page).toMatch(/Historial\s+preservado/);
    expect(editor).toContain("Guardar nueva versión");
    expect(editor).toMatch(
      /no ejecuta producción ni crea movimientos de\s+inventario/,
    );
    expect(editor).toContain("focus:ring-2");
    expect(page).toContain('role={isError ? "alert" : "status"}');
    expect(editor).not.toContain("productionBatch");
  });
});
