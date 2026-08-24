import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("product administration UI", () => {
  it("guards page and mutation with the exact persisted permission", async () => {
    const [page, actions] = await Promise.all([
      readFile(new URL("./page.tsx", import.meta.url), "utf8"),
      readFile(new URL("./actions.ts", import.meta.url), "utf8"),
    ]);
    expect(page).toContain('"administration.products.manage"');
    expect(actions).toContain('"administration.products.manage"');
  });

  it("exposes all scoped configuration in accessible Spanish", async () => {
    const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    for (const name of [
      "categoryId",
      "displayOrder",
      "isActive",
      "name",
      "unitPrice",
      "printerAlias",
      "taxRateId",
      "priceIncludesTax",
      "recipeId",
      "resaleInventoryItemId",
      "optionLines",
      "removableIngredientLines",
    ])
      expect(page).toContain(`name="${name}"`);
    for (const label of [
      "Catálogo de productos",
      "Guardar nueva versión",
      "Alias de impresora",
      "Ingredientes removibles",
      "Producto activo",
      "El precio incluye impuesto",
    ])
      expect(page).toContain(label);
    expect(page).toContain("no genera movimientos de inventario");
    expect(page).toContain("min-h-12");
    expect(page).toContain("focus:ring-2");
  });
});
