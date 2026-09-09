import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ProductionBatchHistoryEntry,
  ProductionHistoryReader,
} from "../../application";

const batchFields = `
  id, restaurant_id, recipe_version_id, status, produced_quantity,
  unit_of_measure, completed_by_id, completed_at, notes,
  recipe_version:recipe_versions!production_batches_recipe_version_fkey (
    id, recipe_id, version_number,
    recipe:recipes!recipe_versions_recipe_fkey ( id, product_id, name )
  ),
  completed_by:application_users!production_batches_completed_by_fkey (
    id, display_name
  )
`;

export class ProductionHistoryReadError extends Error {
  constructor() {
    super("Production history could not be read.");
    this.name = "ProductionHistoryReadError";
  }
}

export class SupabaseProductionHistoryReader implements ProductionHistoryReader {
  constructor(private readonly client: SupabaseClient) {}

  async read(): Promise<readonly ProductionBatchHistoryEntry[]> {
    try {
      const [batches, restaurants, products, productVersions] =
        await Promise.all([
          this.client
            .from("production_batches")
            .select(batchFields)
            .eq("status", "COMPLETED")
            .order("completed_at", { ascending: false })
            .order("id", { ascending: false }),
          this.client.from("restaurants").select("id, name"),
          this.client.from("products").select("id, restaurant_id"),
          this.client
            .from("product_versions")
            .select("restaurant_id, product_id, version_number, name"),
        ]);
      if (
        batches.error !== null ||
        restaurants.error !== null ||
        products.error !== null ||
        productVersions.error !== null ||
        !Array.isArray(batches.data) ||
        !Array.isArray(restaurants.data) ||
        !Array.isArray(products.data) ||
        !Array.isArray(productVersions.data)
      ) {
        throw new Error();
      }

      const restaurantNames = new Map<string, string>();
      for (const value of restaurants.data) {
        if (!isRecord(value) || !isUuid(value.id) || !isNonblank(value.name))
          throw new Error();
        if (restaurantNames.has(value.id)) throw new Error();
        restaurantNames.set(value.id, value.name);
      }
      const productNames = latestProductNames(
        products.data,
        productVersions.data,
      );

      const batchIds = new Set<string>();
      return Object.freeze(
        batches.data.map((value) => {
          const batch = mapBatch(value, restaurantNames, productNames);
          if (batchIds.has(batch.batchId)) throw new Error();
          batchIds.add(batch.batchId);
          return batch;
        }),
      );
    } catch {
      throw new ProductionHistoryReadError();
    }
  }
}

function mapBatch(
  value: unknown,
  restaurantNames: ReadonlyMap<string, string>,
  productNames: ReadonlyMap<string, string>,
): ProductionBatchHistoryEntry {
  if (!isRecord(value)) throw new Error();
  const version = singleRelation(value.recipe_version);
  const completedBy = singleRelation(value.completed_by);
  const recipe = version ? singleRelation(version.recipe) : null;
  const restaurantName =
    typeof value.restaurant_id === "string"
      ? restaurantNames.get(value.restaurant_id)
      : undefined;
  const producedQuantity = decimal(value.produced_quantity);
  const productName =
    recipe && typeof recipe.product_id === "string"
      ? productNames.get(productKey(value.restaurant_id, recipe.product_id))
      : undefined;
  if (
    !isUuid(value.id) ||
    !isUuid(value.restaurant_id) ||
    !restaurantName ||
    value.status !== "COMPLETED" ||
    !producedQuantity ||
    !isNonblank(value.unit_of_measure) ||
    !isUuid(value.recipe_version_id) ||
    !version ||
    version.id !== value.recipe_version_id ||
    !isUuid(version.recipe_id) ||
    !isPositiveInteger(version.version_number) ||
    !recipe ||
    !isUuid(recipe.id) ||
    recipe.id !== version.recipe_id ||
    !isUuid(recipe.product_id) ||
    !productName ||
    !isNonblank(recipe.name) ||
    !isUuid(value.completed_by_id) ||
    !completedBy ||
    completedBy.id !== value.completed_by_id ||
    !isNonblank(completedBy.display_name) ||
    !timestamp(value.completed_at) ||
    !nullableText(value.notes, 2_000)
  ) {
    throw new Error();
  }
  return Object.freeze({
    batchId: value.id,
    restaurantId: value.restaurant_id,
    restaurantName,
    productId: recipe.product_id as string,
    productName,
    recipeName: recipe.name,
    recipeVersionId: value.recipe_version_id,
    recipeVersionNumber: version.version_number as number,
    producedQuantity,
    unitOfMeasure: value.unit_of_measure,
    completedBy: Object.freeze({
      id: completedBy.id,
      displayName: completedBy.display_name,
    }),
    completedAt: new Date(value.completed_at).toISOString(),
    notes: value.notes,
  });
}

function latestProductNames(
  products: readonly unknown[],
  productVersions: readonly unknown[],
): ReadonlyMap<string, string> {
  const productKeys = new Set<string>();
  for (const value of products) {
    if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.restaurant_id)) {
      throw new Error();
    }
    const key = productKey(value.restaurant_id, value.id);
    if (productKeys.has(key)) throw new Error();
    productKeys.add(key);
  }
  const latest = new Map<string, { versionNumber: number; name: string }>();
  for (const value of productVersions) {
    if (
      !isRecord(value) ||
      !isUuid(value.restaurant_id) ||
      !isUuid(value.product_id) ||
      !isPositiveInteger(value.version_number) ||
      !isNonblank(value.name)
    ) {
      throw new Error();
    }
    const key = productKey(value.restaurant_id, value.product_id);
    if (!productKeys.has(key)) throw new Error();
    const current = latest.get(key);
    if (!current || value.version_number > current.versionNumber) {
      latest.set(key, {
        versionNumber: value.version_number as number,
        name: value.name,
      });
    }
  }
  return new Map([...latest].map(([key, value]) => [key, value.name]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function singleRelation(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() !== "Invalid Date"
  );
}

function nullableText(value: unknown, maximum: number): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= maximum)
  );
}

function decimal(value: unknown): string | null {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+(?:\.\d{1,3})?$/.test(String(value))
  )
    return null;
  const [whole, fraction = ""] = String(value).split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalized = `${normalizedWhole}.${(fraction + "000").slice(0, 3)}`;
  return normalized !== "0.000" ? normalized : null;
}

function productKey(restaurantId: unknown, productId: unknown) {
  return `${restaurantId}:${productId}`;
}
