import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, listRecipes, listHistory } = vi.hoisted(() => ({
  authorize: vi.fn(),
  listRecipes: vi.fn(),
  listHistory: vi.fn(),
}));

vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerAuthorizationContext: authorize,
}));
vi.mock("@/domain", () => ({
  unauthorizedError: () => new Error("Unauthorized"),
}));
vi.mock("@/lib/recipe-administration/server", () => ({
  createRecipeAdministrationService: () => ({ list: listRecipes }),
}));
vi.mock("@/lib/production-history/server", () => ({
  createProductionHistoryService: () => ({ list: listHistory }),
}));
vi.mock("./production-registration-form", () => ({
  ProductionRegistrationForm: () => <p>production form</p>,
}));
vi.mock("./recipe-editor", () => ({
  RecipeEditor: () => <p>recipe editor</p>,
}));

import ProductionPage from "./page";

const recipes = Object.freeze({
  restaurants: [],
  products: [],
  inventoryItems: [],
  recipes: [],
});
const history = Object.freeze([
  {
    batchId: "70000000-0000-4000-8000-000000000001",
    restaurantId: "20000000-0000-4000-8000-000000000001",
    restaurantName: "Centro",
    productId: "40000000-0000-4000-8000-000000000001",
    productName: "Salsa preparada",
    recipeName: "Salsa de la casa",
    recipeVersionId: "60000000-0000-4000-8000-000000000001",
    recipeVersionNumber: 3,
    producedQuantity: "5.000",
    unitOfMeasure: "litro",
    completedBy: {
      id: "10000000-0000-4000-8000-000000000001",
      displayName: "Ana",
    },
    completedAt: "2026-09-08T10:00:00.000Z",
    notes: "Mise en place",
  },
]);

async function page() {
  return renderToStaticMarkup(
    await ProductionPage({ searchParams: Promise.resolve({}) }),
  );
}

describe("ProductionPage", () => {
  beforeEach(() => {
    authorize.mockReset();
    listRecipes.mockReset().mockResolvedValue({ ok: true, value: recipes });
    listHistory.mockReset().mockResolvedValue({ ok: true, value: history });
  });

  it("shows only batch registration for a custom create-only permission", async () => {
    authorize.mockResolvedValue({
      permissionCodes: ["production.batch.create"],
    });

    const markup = await page();

    expect(authorize).toHaveBeenCalledWith("/production");
    expect(markup).toContain("Registrar producción");
    expect(markup).toContain("production form");
    expect(markup).not.toContain("Historial de producción");
    expect(markup).not.toContain("Nueva receta");
    expect(listRecipes).toHaveBeenCalledTimes(1);
    expect(listHistory).not.toHaveBeenCalled();
  });

  it("shows immutable fields only for a custom history-only permission", async () => {
    authorize.mockResolvedValue({
      permissionCodes: ["production.history.view"],
    });

    const markup = await page();

    expect(markup).toContain("Historial de producción");
    expect(markup).toContain("Salsa de la casa");
    expect(markup).toContain("Salsa preparada");
    expect(markup).toContain("Versión 3");
    expect(markup).toContain("Ana");
    expect(markup).toContain("Mise en place");
    expect(markup).not.toContain("Completar producción");
    expect(markup).not.toContain("Nueva receta");
    expect(listRecipes).not.toHaveBeenCalled();
    expect(listHistory).toHaveBeenCalledTimes(1);
  });

  it("keeps recipe administration independently gated", async () => {
    authorize.mockResolvedValue({
      permissionCodes: ["production.recipes.edit"],
    });

    const markup = await page();

    expect(markup).toContain("Nueva receta");
    expect(markup).toContain("recipe editor");
    expect(markup).not.toContain("Registrar producción");
    expect(markup).not.toContain("Historial de producción");
  });
});
