import { err, ok, type Result } from "../../domain";
import type { AuditEventService, JsonObject } from "../audit";

export type RecipeAdministrationRestaurant = Readonly<{
  id: string;
  name: string;
}>;

export type RecipeAdministrationProduct = Readonly<{
  id: string;
  restaurantId: string;
  name: string;
  isActive: boolean;
}>;

export type RecipeAdministrationInventoryItem = Readonly<{
  id: string;
  restaurantId: string;
  name: string;
  type: "RAW_INGREDIENT" | "PRODUCED_ITEM";
  unitOfMeasure: string;
  isActive: boolean;
}>;

export type RecipeIngredient = Readonly<{
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  requiredQuantity: number;
  unitOfMeasure: string;
}>;

export type Recipe = Readonly<{
  id: string;
  restaurantId: string;
  restaurantName: string;
  productId: string;
  productName: string;
  outputInventoryItemId: string;
  outputInventoryItemName: string;
  name: string;
  isActive: boolean;
  versionId: string;
  versionNumber: number;
  availableVersionNumbers: readonly number[];
  producedQuantity: number;
  producedUnit: string;
  ingredients: readonly RecipeIngredient[];
}>;

export type RecipeAdministrationView = Readonly<{
  restaurants: readonly RecipeAdministrationRestaurant[];
  products: readonly RecipeAdministrationProduct[];
  inventoryItems: readonly RecipeAdministrationInventoryItem[];
  recipes: readonly Recipe[];
}>;

export type SaveRecipeIngredientInput = Readonly<{
  inventoryItemId: string;
  requiredQuantity: string;
}>;

export type SaveRecipeInput = Readonly<{
  id?: string;
  restaurantId: string;
  productId: string;
  outputInventoryItemId: string;
  name: string;
  isActive: boolean;
  producedQuantity: string;
  ingredients: readonly SaveRecipeIngredientInput[];
}>;

export interface RecipeAdministrationGateway {
  list(): Promise<RecipeAdministrationView>;
  save(actorId: string, recipe: Recipe): Promise<Recipe>;
}

export type RecipeAdministrationError = Readonly<{
  kind: "recipe-administration-error";
  code: "INVALID_INPUT" | "OPERATION_FAILED";
}>;

export class RecipeAdministrationService {
  constructor(
    private readonly gateway: RecipeAdministrationGateway,
    private readonly audit: AuditEventService,
    private readonly createId: () => string,
  ) {}

  async list(): Promise<
    Result<RecipeAdministrationView, RecipeAdministrationError>
  > {
    try {
      return ok(freezeView(await this.gateway.list()));
    } catch {
      return failure("OPERATION_FAILED");
    }
  }

  async save(
    actorId: string,
    input: SaveRecipeInput,
  ): Promise<Result<Recipe, RecipeAdministrationError>> {
    if (!isUuid(actorId)) return failure("INVALID_INPUT");

    try {
      const view = await this.gateway.list();
      const requestedId = input.id?.trim();
      const current = requestedId
        ? view.recipes.find((recipe) => recipe.id === requestedId)
        : undefined;
      if (requestedId && !current) return failure("OPERATION_FAILED");

      const normalized = normalize(input, current, this.createId);
      if (!normalized) return failure("INVALID_INPUT");
      const restaurant = view.restaurants.find(
        (value) => value.id === normalized.restaurantId,
      );
      const product = view.products.find(
        (value) =>
          value.id === normalized.productId &&
          value.restaurantId === normalized.restaurantId &&
          value.isActive,
      );
      const output = view.inventoryItems.find(
        (value) =>
          value.id === normalized.outputInventoryItemId &&
          value.restaurantId === normalized.restaurantId &&
          value.type === "PRODUCED_ITEM" &&
          value.isActive,
      );
      if (!restaurant || !product || !output)
        return failure("OPERATION_FAILED");
      if (
        current &&
        (current.restaurantId !== normalized.restaurantId ||
          current.productId !== normalized.productId ||
          current.outputInventoryItemId !== normalized.outputInventoryItemId)
      )
        return failure("OPERATION_FAILED");

      const ingredients: RecipeIngredient[] = [];
      for (const ingredient of normalized.ingredients) {
        const item = view.inventoryItems.find(
          (value) =>
            value.id === ingredient.inventoryItemId &&
            value.restaurantId === normalized.restaurantId &&
            value.type === "RAW_INGREDIENT" &&
            value.isActive,
        );
        if (!item) return failure("OPERATION_FAILED");
        ingredients.push(
          Object.freeze({
            ...ingredient,
            inventoryItemName: item.name,
            unitOfMeasure: item.unitOfMeasure,
          }),
        );
      }
      ingredients.sort(
        (a, b) =>
          a.inventoryItemId.localeCompare(b.inventoryItemId) ||
          a.id.localeCompare(b.id),
      );

      const desired: Recipe = Object.freeze({
        id: normalized.id,
        restaurantId: normalized.restaurantId,
        restaurantName: restaurant.name,
        productId: normalized.productId,
        productName: product.name,
        outputInventoryItemId: normalized.outputInventoryItemId,
        outputInventoryItemName: output.name,
        name: normalized.name,
        isActive: normalized.isActive,
        versionId: normalized.versionId,
        versionNumber: (current?.versionNumber ?? 0) + 1,
        availableVersionNumbers: Object.freeze([
          ...(current?.availableVersionNumbers ?? []),
          (current?.versionNumber ?? 0) + 1,
        ]),
        producedQuantity: normalized.producedQuantity,
        producedUnit: output.unitOfMeasure,
        ingredients: Object.freeze(ingredients),
      });
      const audit = await this.audit.record({
        actorId,
        action: actionFor(current, desired),
        entityType: "recipe",
        entityId: desired.id,
        previousValues: current ? snapshot(current) : null,
        newValues: snapshot(desired),
      });
      if (!audit.ok) return failure("OPERATION_FAILED");
      return ok(await this.gateway.save(actorId, desired));
    } catch {
      return failure("OPERATION_FAILED");
    }
  }
}

function normalize(
  input: SaveRecipeInput,
  current: Recipe | undefined,
  createId: () => string,
) {
  const id = input.id?.trim() || createId();
  const versionId = createId();
  const restaurantId = input.restaurantId.trim();
  const productId = input.productId.trim();
  const outputInventoryItemId = input.outputInventoryItemId.trim();
  const name = input.name.trim().replace(/\s+/g, " ");
  const producedQuantity = parsePositiveQuantity(input.producedQuantity);
  if (
    ![id, versionId, restaurantId, productId, outputInventoryItemId].every(
      isUuid,
    ) ||
    name.length < 1 ||
    name.length > 120 ||
    producedQuantity === null ||
    !Array.isArray(input.ingredients) ||
    input.ingredients.length < 1 ||
    input.ingredients.length > 100
  )
    return null;

  const seen = new Set<string>();
  const ingredients = [];
  for (const line of input.ingredients) {
    const inventoryItemId = line.inventoryItemId.trim();
    const requiredQuantity = parsePositiveQuantity(line.requiredQuantity);
    const ingredientId = createId();
    if (
      !isUuid(inventoryItemId) ||
      !isUuid(ingredientId) ||
      requiredQuantity === null ||
      seen.has(inventoryItemId)
    )
      return null;
    seen.add(inventoryItemId);
    ingredients.push(
      Object.freeze({ id: ingredientId, inventoryItemId, requiredQuantity }),
    );
  }
  return Object.freeze({
    id,
    versionId,
    restaurantId,
    productId,
    outputInventoryItemId,
    name,
    isActive: input.isActive,
    producedQuantity,
    ingredients: Object.freeze(ingredients),
    expectedPreviousVersionNumber: current?.versionNumber ?? 0,
  });
}

function parsePositiveQuantity(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(normalized)) return null;
  const quantity = Number(normalized);
  return Number.isFinite(quantity) &&
    quantity > 0 &&
    quantity <= 99999999999.999
    ? quantity
    : null;
}

function actionFor(current: Recipe | undefined, desired: Recipe) {
  if (!current) return "recipe.created";
  if (current.isActive !== desired.isActive)
    return desired.isActive ? "recipe.activated" : "recipe.deactivated";
  return "recipe.updated";
}

function snapshot(recipe: Recipe): JsonObject {
  return {
    restaurantId: recipe.restaurantId,
    productId: recipe.productId,
    outputInventoryItemId: recipe.outputInventoryItemId,
    name: recipe.name,
    isActive: recipe.isActive,
    versionId: recipe.versionId,
    versionNumber: recipe.versionNumber,
    producedQuantity: recipe.producedQuantity,
    producedUnit: recipe.producedUnit,
    ingredients: recipe.ingredients.map((ingredient) => ({
      id: ingredient.id,
      inventoryItemId: ingredient.inventoryItemId,
      requiredQuantity: ingredient.requiredQuantity,
      unitOfMeasure: ingredient.unitOfMeasure,
    })),
  };
}

function freezeView(view: RecipeAdministrationView) {
  return Object.freeze({
    restaurants: Object.freeze([...view.restaurants]),
    products: Object.freeze([...view.products]),
    inventoryItems: Object.freeze([...view.inventoryItems]),
    recipes: Object.freeze([...view.recipes]),
  });
}

function failure(code: RecipeAdministrationError["code"]) {
  return err(
    Object.freeze({ kind: "recipe-administration-error" as const, code }),
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
