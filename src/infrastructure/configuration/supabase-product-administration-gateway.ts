import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuditEventAppender,
  AuditEventRecord,
  Product,
  ProductAdministrationCategory,
  ProductAdministrationGateway,
  ProductAdministrationRecipe,
  ProductAdministrationResaleItem,
  ProductAdministrationRestaurant,
  ProductAdministrationTaxRate,
  ProductAdministrationView,
  ProductModification,
} from "../../application";

export class SupabaseProductAdministrationGateway
  implements ProductAdministrationGateway, AuditEventAppender
{
  private pendingAudit: AuditEventRecord | null = null;

  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<ProductAdministrationView> {
    try {
      const [
        restaurants,
        catalogs,
        categories,
        taxRates,
        products,
        versions,
        options,
        removals,
        recipes,
        resaleItems,
      ] = await Promise.all([
        this.client
          .from("restaurants")
          .select("id, name")
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("product_catalogs")
          .select("restaurant_id")
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("product_categories")
          .select("id, restaurant_id, name, is_active")
          .is("deleted_at", null),
        this.client
          .from("restaurant_tax_rates")
          .select("id, restaurant_id, code, name, rate, is_active")
          .is("deleted_at", null),
        this.client
          .from("products")
          .select("id, restaurant_id, category_id, display_order, is_active")
          .is("deleted_at", null),
        this.client
          .from("product_versions")
          .select(
            "id, restaurant_id, product_id, version_number, name, unit_price, printer_alias, tax_rate_id, tax_code, tax_name, tax_rate, price_includes_tax, recipe_id, resale_inventory_item_id",
          ),
        this.client
          .from("product_options")
          .select(
            "id, restaurant_id, product_version_id, name, price_adjustment, display_order",
          ),
        this.client
          .from("product_removable_ingredients")
          .select(
            "id, restaurant_id, product_version_id, name, price_adjustment, display_order",
          ),
        this.client
          .from("recipes")
          .select("id, restaurant_id, product_id, name")
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("inventory_items")
          .select("id, restaurant_id, name, unit_of_measure")
          .eq("type", "RESALE_ITEM")
          .eq("is_active", true)
          .is("deleted_at", null),
      ]);

      const responses = [
        restaurants,
        catalogs,
        categories,
        taxRates,
        products,
        versions,
        options,
        removals,
        recipes,
        resaleItems,
      ];
      if (
        responses.some(
          (response) => response.error || !Array.isArray(response.data),
        )
      )
        throw new Error();

      const catalogRestaurantIds = new Set(
        (catalogs.data as unknown[]).map(mapCatalog),
      );
      const restaurantList = (restaurants.data as unknown[])
        .map(mapRestaurant)
        .filter((restaurant) => catalogRestaurantIds.has(restaurant.id))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      const restaurantNames = new Map(
        restaurantList.map((restaurant) => [restaurant.id, restaurant.name]),
      );
      const categoryList = (categories.data as unknown[])
        .map(mapCategory)
        .filter((category) => restaurantNames.has(category.restaurantId))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      const categoryNames = new Map(
        categoryList.map((category) => [
          scopedId(category.restaurantId, category.id),
          category.name,
        ]),
      );
      const taxRateList = (taxRates.data as unknown[])
        .map(mapTaxRate)
        .filter((rate) => restaurantNames.has(rate.restaurantId))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      const recipeList = (recipes.data as unknown[])
        .map(mapRecipe)
        .filter((recipe) => restaurantNames.has(recipe.restaurantId))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      const resaleItemList = (resaleItems.data as unknown[])
        .map(mapResaleItem)
        .filter((item) => restaurantNames.has(item.restaurantId))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));

      const latestVersions = new Map<string, VersionRow>();
      for (const version of (versions.data as unknown[]).map(mapVersion)) {
        const key = scopedId(version.restaurantId, version.productId);
        const current = latestVersions.get(key);
        if (!current || version.versionNumber > current.versionNumber)
          latestVersions.set(key, version);
      }
      const optionGroups = groupModifications(options.data as unknown[]);
      const removalGroups = groupModifications(removals.data as unknown[]);
      const productList = (products.data as unknown[])
        .map((row) =>
          mapProduct(
            row,
            restaurantNames,
            categoryNames,
            latestVersions,
            optionGroups,
            removalGroups,
          ),
        )
        .sort(
          (a, b) =>
            a.restaurantName.localeCompare(b.restaurantName, "es") ||
            a.categoryName.localeCompare(b.categoryName, "es") ||
            a.displayOrder - b.displayOrder ||
            a.name.localeCompare(b.name, "es"),
        );

      return Object.freeze({
        restaurants: Object.freeze(restaurantList),
        categories: Object.freeze(categoryList),
        taxRates: Object.freeze(taxRateList),
        recipes: Object.freeze(recipeList),
        resaleItems: Object.freeze(resaleItemList),
        products: Object.freeze(productList),
      });
    } catch {
      throw new Error("Product persistence failed.");
    }
  }

  async save(actorId: string, product: Product): Promise<Product> {
    try {
      const audit = this.pendingAudit;
      if (!audit || audit.actorId !== actorId || audit.entityId !== product.id)
        throw new Error();

      const { data, error } = await this.client.rpc("save_product", {
        actor_user_id: actorId,
        target_restaurant_id: product.restaurantId,
        target_product_id: product.id,
        target_product_version_id: product.versionId,
        expected_previous_version_number: product.versionNumber - 1,
        target_category_id: product.categoryId,
        product_display_order: product.displayOrder,
        product_is_active: product.isActive,
        product_name: product.name,
        product_unit_price: product.unitPrice,
        product_printer_alias: product.printerAlias,
        target_tax_rate_id: product.taxRateId,
        product_price_includes_tax: product.priceIncludesTax,
        target_recipe_id: product.recipeId,
        target_resale_inventory_item_id: product.resaleInventoryItemId,
        product_options_text: JSON.stringify(product.options),
        product_removals_text: JSON.stringify(product.removableIngredients),
        audit_event_text: JSON.stringify(audit),
      });
      if (error || !Array.isArray(data) || data.length !== 1) throw new Error();
      return Object.freeze(product);
    } catch {
      throw new Error("Product persistence failed.");
    } finally {
      this.pendingAudit = null;
    }
  }

  async append(event: AuditEventRecord) {
    if (this.pendingAudit) throw new Error("Audit transaction is busy.");
    this.pendingAudit = event;
  }
}

type VersionRow = Readonly<{
  id: string;
  restaurantId: string;
  productId: string;
  versionNumber: number;
  name: string;
  unitPrice: number;
  printerAlias: string;
  taxRateId: string;
  taxCode: string;
  taxName: string;
  taxRate: number;
  priceIncludesTax: boolean;
  recipeId: string | null;
  resaleInventoryItemId: string | null;
}>;

function mapCatalog(row: unknown) {
  if (!isRecord(row) || typeof row.restaurant_id !== "string")
    throw new Error();
  return row.restaurant_id;
}

function mapRestaurant(row: unknown): ProductAdministrationRestaurant {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.name !== "string"
  )
    throw new Error();
  return Object.freeze({ id: row.id, name: row.name });
}

function mapCategory(row: unknown): ProductAdministrationCategory {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.is_active !== "boolean"
  )
    throw new Error();
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    isActive: row.is_active,
  });
}

function mapTaxRate(row: unknown): ProductAdministrationTaxRate {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.code !== "string" ||
    typeof row.name !== "string" ||
    typeof row.is_active !== "boolean"
  )
    throw new Error();
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    code: row.code,
    name: row.name,
    rate: decimal(row.rate),
    isActive: row.is_active,
  });
}

function mapRecipe(row: unknown): ProductAdministrationRecipe {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.product_id !== "string" ||
    typeof row.name !== "string"
  )
    throw new Error();
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    productId: row.product_id,
    name: row.name,
  });
}

function mapResaleItem(row: unknown): ProductAdministrationResaleItem {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.unit_of_measure !== "string"
  )
    throw new Error();
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    unitOfMeasure: row.unit_of_measure,
  });
}

function mapVersion(row: unknown): VersionRow {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.product_id !== "string" ||
    !Number.isInteger(row.version_number) ||
    typeof row.name !== "string" ||
    typeof row.printer_alias !== "string" ||
    typeof row.tax_rate_id !== "string" ||
    typeof row.tax_code !== "string" ||
    typeof row.tax_name !== "string" ||
    typeof row.price_includes_tax !== "boolean" ||
    !isNullableString(row.recipe_id) ||
    !isNullableString(row.resale_inventory_item_id)
  )
    throw new Error();
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    productId: row.product_id,
    versionNumber: row.version_number as number,
    name: row.name,
    unitPrice: decimal(row.unit_price),
    printerAlias: row.printer_alias,
    taxRateId: row.tax_rate_id,
    taxCode: row.tax_code,
    taxName: row.tax_name,
    taxRate: decimal(row.tax_rate),
    priceIncludesTax: row.price_includes_tax,
    recipeId: row.recipe_id,
    resaleInventoryItemId: row.resale_inventory_item_id,
  });
}

function groupModifications(rows: unknown[]) {
  const groups = new Map<string, ProductModification[]>();
  for (const row of rows) {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      typeof row.restaurant_id !== "string" ||
      typeof row.product_version_id !== "string" ||
      typeof row.name !== "string" ||
      !Number.isInteger(row.display_order) ||
      !(row.price_adjustment === null || isDecimal(row.price_adjustment))
    )
      throw new Error();
    const key = scopedId(row.restaurant_id, row.product_version_id);
    const group = groups.get(key) ?? [];
    group.push(
      Object.freeze({
        id: row.id,
        name: row.name,
        priceAdjustment:
          row.price_adjustment === null ? null : decimal(row.price_adjustment),
        displayOrder: row.display_order as number,
      }),
    );
    groups.set(key, group);
  }
  for (const group of groups.values())
    group.sort(
      (a, b) =>
        a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, "es"),
    );
  return groups;
}

function mapProduct(
  row: unknown,
  restaurantNames: ReadonlyMap<string, string>,
  categoryNames: ReadonlyMap<string, string>,
  versions: ReadonlyMap<string, VersionRow>,
  options: ReadonlyMap<string, readonly ProductModification[]>,
  removals: ReadonlyMap<string, readonly ProductModification[]>,
): Product {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.category_id !== "string" ||
    !Number.isInteger(row.display_order) ||
    typeof row.is_active !== "boolean"
  )
    throw new Error();
  const restaurantName = restaurantNames.get(row.restaurant_id);
  const categoryName = categoryNames.get(
    scopedId(row.restaurant_id, row.category_id),
  );
  const version = versions.get(scopedId(row.restaurant_id, row.id));
  if (!restaurantName || !categoryName || !version) throw new Error();
  const versionKey = scopedId(row.restaurant_id, version.id);
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    restaurantName,
    categoryId: row.category_id,
    categoryName,
    displayOrder: row.display_order as number,
    isActive: row.is_active,
    versionId: version.id,
    versionNumber: version.versionNumber,
    name: version.name,
    unitPrice: version.unitPrice,
    printerAlias: version.printerAlias,
    taxRateId: version.taxRateId,
    taxCode: version.taxCode,
    taxName: version.taxName,
    taxRate: version.taxRate,
    priceIncludesTax: version.priceIncludesTax,
    recipeId: version.recipeId,
    resaleInventoryItemId: version.resaleInventoryItemId,
    options: Object.freeze([...(options.get(versionKey) ?? [])]),
    removableIngredients: Object.freeze([...(removals.get(versionKey) ?? [])]),
  });
}

function decimal(value: unknown) {
  if (!isDecimal(value)) throw new Error();
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error();
  return result;
}

function isDecimal(value: unknown): value is string | number {
  return (
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value))
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function scopedId(restaurantId: string, id: string) {
  return `${restaurantId}:${id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
