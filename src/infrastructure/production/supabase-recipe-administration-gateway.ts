import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuditEventAppender,
  AuditEventRecord,
  Recipe,
  RecipeAdministrationGateway,
  RecipeAdministrationInventoryItem,
  RecipeAdministrationProduct,
  RecipeAdministrationView,
  RecipeIngredient,
} from "../../application";

export class SupabaseRecipeAdministrationGateway
  implements RecipeAdministrationGateway, AuditEventAppender
{
  private pendingAudit: AuditEventRecord | null = null;

  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<RecipeAdministrationView> {
    try {
      const [
        restaurants,
        products,
        productVersions,
        inventoryItems,
        recipes,
        versions,
        ingredients,
      ] = await Promise.all([
        this.client
          .from("restaurants")
          .select("id, name")
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("products")
          .select("id, restaurant_id, is_active")
          .is("deleted_at", null),
        this.client
          .from("product_versions")
          .select("id, restaurant_id, product_id, version_number, name"),
        this.client
          .from("inventory_items")
          .select("id, restaurant_id, name, type, unit_of_measure, is_active")
          .in("type", ["RAW_INGREDIENT", "PRODUCED_ITEM"])
          .is("deleted_at", null),
        this.client
          .from("recipes")
          .select(
            "id, restaurant_id, product_id, output_inventory_item_id, name, is_active",
          )
          .is("deleted_at", null),
        this.client
          .from("recipe_versions")
          .select(
            "id, restaurant_id, recipe_id, version_number, produced_quantity, produced_unit",
          ),
        this.client
          .from("recipe_ingredients")
          .select(
            "id, restaurant_id, recipe_version_id, inventory_item_id, required_quantity, unit_of_measure",
          ),
      ]);
      const responses = [
        restaurants,
        products,
        productVersions,
        inventoryItems,
        recipes,
        versions,
        ingredients,
      ];
      if (
        responses.some(
          (response) => response.error || !Array.isArray(response.data),
        )
      )
        throw new Error();

      const restaurantList = (restaurants.data as unknown[])
        .map(mapRestaurant)
        .sort(byName);
      const restaurantNames = new Map(
        restaurantList.map((value) => [value.id, value.name]),
      );
      const latestProductVersions = new Map<string, ProductVersionRow>();
      for (const version of (productVersions.data as unknown[]).map(
        mapProductVersion,
      )) {
        const key = scoped(version.restaurantId, version.productId);
        const current = latestProductVersions.get(key);
        if (!current || version.versionNumber > current.versionNumber)
          latestProductVersions.set(key, version);
      }
      const productList = (products.data as unknown[])
        .map((row) => mapProduct(row, latestProductVersions))
        .filter((value) => restaurantNames.has(value.restaurantId))
        .sort(byName);
      const productNames = new Map(
        productList.map((value) => [
          scoped(value.restaurantId, value.id),
          value.name,
        ]),
      );
      const itemList = (inventoryItems.data as unknown[])
        .map(mapInventoryItem)
        .filter((value) => restaurantNames.has(value.restaurantId))
        .sort(byName);
      const itemById = new Map(
        itemList.map((value) => [scoped(value.restaurantId, value.id), value]),
      );
      const ingredientGroups = groupIngredients(
        ingredients.data as unknown[],
        itemById,
      );
      const versionGroups = groupVersions(versions.data as unknown[]);
      const recipeList = (recipes.data as unknown[])
        .map((row) =>
          mapRecipe(
            row,
            restaurantNames,
            productNames,
            itemById,
            versionGroups,
            ingredientGroups,
          ),
        )
        .filter((value): value is Recipe => value !== null)
        .sort(
          (a, b) =>
            a.restaurantName.localeCompare(b.restaurantName, "es") ||
            a.name.localeCompare(b.name, "es"),
        );

      return Object.freeze({
        restaurants: Object.freeze(restaurantList),
        products: Object.freeze(productList),
        inventoryItems: Object.freeze(itemList),
        recipes: Object.freeze(recipeList),
      });
    } catch {
      throw new Error("Recipe persistence failed.");
    }
  }

  async save(actorId: string, recipe: Recipe): Promise<Recipe> {
    try {
      const audit = this.pendingAudit;
      if (!audit || audit.actorId !== actorId || audit.entityId !== recipe.id)
        throw new Error();
      const { data, error } = await this.client.rpc("save_recipe", {
        actor_user_id: actorId,
        target_restaurant_id: recipe.restaurantId,
        target_recipe_id: recipe.id,
        target_recipe_version_id: recipe.versionId,
        expected_previous_version_number: recipe.versionNumber - 1,
        target_product_id: recipe.productId,
        target_output_inventory_item_id: recipe.outputInventoryItemId,
        recipe_name: recipe.name,
        recipe_is_active: recipe.isActive,
        recipe_produced_quantity: recipe.producedQuantity,
        recipe_ingredients_text: JSON.stringify(
          recipe.ingredients.map((ingredient) => ({
            id: ingredient.id,
            inventoryItemId: ingredient.inventoryItemId,
            requiredQuantity: ingredient.requiredQuantity,
            unitOfMeasure: ingredient.unitOfMeasure,
          })),
        ),
        audit_event_text: JSON.stringify(audit),
      });
      if (error || !Array.isArray(data) || data.length !== 1) throw new Error();
      return Object.freeze(recipe);
    } catch {
      throw new Error("Recipe persistence failed.");
    } finally {
      this.pendingAudit = null;
    }
  }

  async append(event: AuditEventRecord) {
    if (this.pendingAudit) throw new Error("Audit transaction is busy.");
    this.pendingAudit = event;
  }
}

type ProductVersionRow = Readonly<{
  restaurantId: string;
  productId: string;
  versionNumber: number;
  name: string;
}>;
type VersionRow = Readonly<{
  id: string;
  restaurantId: string;
  recipeId: string;
  versionNumber: number;
  producedQuantity: number;
  producedUnit: string;
}>;

function mapRestaurant(row: unknown) {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.name !== "string"
  )
    throw new Error();
  return Object.freeze({ id: row.id, name: row.name });
}

function mapProductVersion(row: unknown): ProductVersionRow {
  if (
    !isRecord(row) ||
    typeof row.restaurant_id !== "string" ||
    typeof row.product_id !== "string" ||
    typeof row.version_number !== "number" ||
    typeof row.name !== "string"
  )
    throw new Error();
  return Object.freeze({
    restaurantId: row.restaurant_id,
    productId: row.product_id,
    versionNumber: row.version_number,
    name: row.name,
  });
}

function mapProduct(
  row: unknown,
  versions: ReadonlyMap<string, ProductVersionRow>,
): RecipeAdministrationProduct {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.is_active !== "boolean"
  )
    throw new Error();
  const version = versions.get(scoped(row.restaurant_id, row.id));
  if (!version) throw new Error();
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    name: version.name,
    isActive: row.is_active,
  });
}

function mapInventoryItem(row: unknown): RecipeAdministrationInventoryItem {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.name !== "string" ||
    !["RAW_INGREDIENT", "PRODUCED_ITEM"].includes(row.type as string) ||
    typeof row.unit_of_measure !== "string" ||
    typeof row.is_active !== "boolean"
  )
    throw new Error();
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    type: row.type as "RAW_INGREDIENT" | "PRODUCED_ITEM",
    unitOfMeasure: row.unit_of_measure,
    isActive: row.is_active,
  });
}

function mapVersion(row: unknown): VersionRow {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.recipe_id !== "string" ||
    typeof row.version_number !== "number" ||
    typeof row.produced_unit !== "string"
  )
    throw new Error();
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    recipeId: row.recipe_id,
    versionNumber: row.version_number,
    producedQuantity: decimal(row.produced_quantity),
    producedUnit: row.produced_unit,
  });
}

function groupVersions(rows: unknown[]) {
  const groups = new Map<string, VersionRow[]>();
  for (const version of rows.map(mapVersion)) {
    const key = scoped(version.restaurantId, version.recipeId);
    groups.set(key, [...(groups.get(key) ?? []), version]);
  }
  for (const values of groups.values())
    values.sort((a, b) => a.versionNumber - b.versionNumber);
  return groups;
}

function groupIngredients(
  rows: unknown[],
  items: ReadonlyMap<string, RecipeAdministrationInventoryItem>,
) {
  const groups = new Map<string, RecipeIngredient[]>();
  for (const row of rows) {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      typeof row.restaurant_id !== "string" ||
      typeof row.recipe_version_id !== "string" ||
      typeof row.inventory_item_id !== "string" ||
      typeof row.unit_of_measure !== "string"
    )
      throw new Error();
    const item = items.get(scoped(row.restaurant_id, row.inventory_item_id));
    if (!item) throw new Error();
    const value = Object.freeze({
      id: row.id,
      inventoryItemId: row.inventory_item_id,
      inventoryItemName: item.name,
      requiredQuantity: decimal(row.required_quantity),
      unitOfMeasure: row.unit_of_measure,
    });
    const key = scoped(row.restaurant_id, row.recipe_version_id);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  for (const values of groups.values())
    values.sort(
      (a, b) =>
        a.inventoryItemId.localeCompare(b.inventoryItemId) ||
        a.id.localeCompare(b.id),
    );
  return groups;
}

function mapRecipe(
  row: unknown,
  restaurantNames: ReadonlyMap<string, string>,
  productNames: ReadonlyMap<string, string>,
  items: ReadonlyMap<string, RecipeAdministrationInventoryItem>,
  versions: ReadonlyMap<string, VersionRow[]>,
  ingredients: ReadonlyMap<string, RecipeIngredient[]>,
): Recipe | null {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.product_id !== "string" ||
    typeof row.output_inventory_item_id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.is_active !== "boolean"
  )
    throw new Error();
  const restaurantName = restaurantNames.get(row.restaurant_id);
  if (!restaurantName) return null;
  const productName = productNames.get(
    scoped(row.restaurant_id, row.product_id),
  );
  const output = items.get(
    scoped(row.restaurant_id, row.output_inventory_item_id),
  );
  const history = versions.get(scoped(row.restaurant_id, row.id));
  const latest = history?.at(-1);
  if (!productName || !output || !history || !latest) throw new Error();
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    restaurantName,
    productId: row.product_id,
    productName,
    outputInventoryItemId: row.output_inventory_item_id,
    outputInventoryItemName: output.name,
    name: row.name,
    isActive: row.is_active,
    versionId: latest.id,
    versionNumber: latest.versionNumber,
    availableVersionNumbers: Object.freeze(
      history.map((value) => value.versionNumber),
    ),
    producedQuantity: latest.producedQuantity,
    producedUnit: latest.producedUnit,
    ingredients: Object.freeze([
      ...(ingredients.get(scoped(row.restaurant_id, latest.id)) ?? []),
    ]),
  });
}

function decimal(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error();
  return parsed;
}

function scoped(restaurantId: string, id: string) {
  return `${restaurantId}:${id}`;
}
function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, "es");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
