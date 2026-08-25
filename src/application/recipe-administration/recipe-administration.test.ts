import { describe, expect, it, vi } from "vitest";

import { AuditEventService } from "../audit";
import type { Recipe, RecipeAdministrationView } from "./recipe-administration";
import { RecipeAdministrationService } from "./recipe-administration";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const productId = "40000000-0000-4000-8000-000000000001";
const outputId = "50000000-0000-4000-8000-000000000001";
const rawId = "51000000-0000-4000-8000-000000000001";
const recipeId = "60000000-0000-4000-8000-000000000001";

const current: Recipe = Object.freeze({
  id: recipeId,
  restaurantId,
  restaurantName: "Carnales",
  productId,
  productName: "Salsa",
  outputInventoryItemId: outputId,
  outputInventoryItemName: "Salsa preparada",
  name: "Salsa base",
  isActive: true,
  versionId: "61000000-0000-4000-8000-000000000001",
  versionNumber: 1,
  availableVersionNumbers: Object.freeze([1]),
  producedQuantity: 2,
  producedUnit: "litro",
  ingredients: Object.freeze([
    Object.freeze({
      id: "62000000-0000-4000-8000-000000000001",
      inventoryItemId: rawId,
      inventoryItemName: "Tomate",
      requiredQuantity: 1.5,
      unitOfMeasure: "kg",
    }),
  ]),
});

function view(
  recipes: readonly Recipe[] = [current],
): RecipeAdministrationView {
  return Object.freeze({
    restaurants: Object.freeze([{ id: restaurantId, name: "Carnales" }]),
    products: Object.freeze([
      { id: productId, restaurantId, name: "Salsa", isActive: true },
    ]),
    inventoryItems: Object.freeze([
      {
        id: outputId,
        restaurantId,
        name: "Salsa preparada",
        type: "PRODUCED_ITEM" as const,
        unitOfMeasure: "litro",
        isActive: true,
      },
      {
        id: rawId,
        restaurantId,
        name: "Tomate",
        type: "RAW_INGREDIENT" as const,
        unitOfMeasure: "kg",
        isActive: true,
      },
    ]),
    recipes: Object.freeze([...recipes]),
  });
}

function setup(recipes: readonly Recipe[] = [current]) {
  let sequence = 0;
  const events: unknown[] = [];
  const gateway = {
    list: vi.fn().mockResolvedValue(view(recipes)),
    save: vi.fn(async (_actorId: string, recipe: Recipe) => recipe),
    append: vi.fn(async (event: unknown) => {
      events.push(event);
    }),
  };
  const service = new RecipeAdministrationService(
    gateway,
    new AuditEventService(gateway, {
      now: () => new Date("2026-08-24T18:00:00.000Z"),
    }),
    () => `90000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  );
  return { service, gateway, events };
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    id: recipeId,
    restaurantId,
    productId,
    outputInventoryItemId: outputId,
    name: " Salsa   especial ",
    isActive: true,
    producedQuantity: "3.500",
    ingredients: [{ inventoryItemId: rawId, requiredQuantity: "2.250" }],
    ...overrides,
  };
}

describe("RecipeAdministrationService", () => {
  it("creates version 1 and allows another recipe for the same product", async () => {
    const { service, gateway, events } = setup([current]);
    const result = await service.save(actorId, {
      ...validInput(),
      id: undefined,
      name: "Otra salsa",
    });
    expect(result.ok).toBe(true);
    expect(gateway.save).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({
        versionNumber: 1,
        productId,
        name: "Otra salsa",
        producedUnit: "litro",
      }),
    );
    expect(events[0]).toMatchObject({
      action: "recipe.created",
      entityType: "recipe",
      previousValues: null,
      newValues: { versionNumber: 1 },
    });
  });

  it("creates N+1 with fresh immutable IDs and the exact previous snapshot", async () => {
    const { service, gateway, events } = setup();
    const result = await service.save(actorId, validInput());
    expect(result.ok).toBe(true);
    expect(gateway.save).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({
        versionNumber: 2,
        availableVersionNumbers: [1, 2],
        ingredients: [
          expect.objectContaining({
            inventoryItemId: rawId,
            requiredQuantity: 2.25,
            unitOfMeasure: "kg",
          }),
        ],
      }),
    );
    const saved = gateway.save.mock.calls[0]?.[1];
    expect(saved?.versionId).not.toBe(current.versionId);
    expect(saved?.ingredients[0]?.id).not.toBe(current.ingredients[0]?.id);
    expect(events[0]).toMatchObject({
      action: "recipe.updated",
      previousValues: { versionId: current.versionId, versionNumber: 1 },
      newValues: { name: "Salsa especial", versionNumber: 2 },
    });
  });

  it.each([
    { producedQuantity: "0" },
    { producedQuantity: "1.0001" },
    { ingredients: [] },
    { ingredients: [{ inventoryItemId: rawId, requiredQuantity: "0" }] },
    {
      ingredients: [
        { inventoryItemId: rawId, requiredQuantity: "1" },
        { inventoryItemId: rawId, requiredQuantity: "2" },
      ],
    },
    { name: " " },
  ])(
    "rejects malformed, empty, duplicate, non-positive, or over-precision input",
    async (override) => {
      const { service, gateway, events } = setup();
      const result = await service.save(actorId, validInput(override));
      expect(result.ok).toBe(false);
      expect(gateway.save).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    },
  );

  it.each([
    { restaurantId: "30000000-0000-4000-8000-000000000002" },
    { productId: "40000000-0000-4000-8000-000000000002" },
    { outputInventoryItemId: "50000000-0000-4000-8000-000000000002" },
  ])("rejects identity or restaurant reassignment", async (override) => {
    const { service, gateway } = setup();
    const result = await service.save(actorId, validInput(override));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
    expect(gateway.save).not.toHaveBeenCalled();
  });

  it("fails closed when audit staging or persistence fails", async () => {
    const first = setup();
    first.gateway.append.mockRejectedValueOnce(new Error("audit"));
    await expect(
      first.service.save(actorId, validInput()),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
    expect(first.gateway.save).not.toHaveBeenCalled();
    const second = setup();
    second.gateway.save.mockRejectedValueOnce(new Error("rpc"));
    await expect(
      second.service.save(actorId, validInput()),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
  });
});
