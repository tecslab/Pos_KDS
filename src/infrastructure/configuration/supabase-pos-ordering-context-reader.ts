import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  PosOrderingContext,
  PosOrderingContextCategory,
  PosOrderingContextModification,
  PosOrderingContextProduct,
  PosOrderingContextReader,
  PosOrderingContextRestaurant,
  PosOrderingContextServiceLocation,
} from "../../application";

export class SupabasePosOrderingContextReader implements PosOrderingContextReader {
  constructor(private readonly client: SupabaseClient) {}

  async read(): Promise<PosOrderingContext> {
    try {
      const [
        restaurantResponse,
        catalogResponse,
        locationResponse,
        categoryResponse,
        productResponse,
        versionResponse,
        optionResponse,
        removalResponse,
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
          .from("service_locations")
          .select(
            "id, restaurant_id, name, type, display_order, allows_multiple_active_orders",
          )
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("product_categories")
          .select("id, restaurant_id, name, display_order")
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("products")
          .select("id, restaurant_id, category_id, display_order")
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("product_versions")
          .select(
            "id, restaurant_id, product_id, version_number, name, unit_price, printer_alias, tax_rate_id, tax_code, tax_name, tax_rate, price_includes_tax",
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
      ]);

      const responses = [
        restaurantResponse,
        catalogResponse,
        locationResponse,
        categoryResponse,
        productResponse,
        versionResponse,
        optionResponse,
        removalResponse,
      ];
      if (
        responses.some(
          (response) => response.error || !Array.isArray(response.data),
        )
      ) {
        throw new Error();
      }

      return assembleContext({
        restaurants: restaurantResponse.data as unknown[],
        catalogs: catalogResponse.data as unknown[],
        locations: locationResponse.data as unknown[],
        categories: categoryResponse.data as unknown[],
        products: productResponse.data as unknown[],
        versions: versionResponse.data as unknown[],
        options: optionResponse.data as unknown[],
        removals: removalResponse.data as unknown[],
      });
    } catch {
      throw new Error("PoS ordering context persistence failed.");
    }
  }
}

type RawContext = Readonly<{
  restaurants: unknown[];
  catalogs: unknown[];
  locations: unknown[];
  categories: unknown[];
  products: unknown[];
  versions: unknown[];
  options: unknown[];
  removals: unknown[];
}>;

type RestaurantRow = Readonly<{ id: string; name: string }>;
type CatalogRow = Readonly<{ restaurantId: string }>;
type LocationRow = Readonly<{
  id: string;
  restaurantId: string;
  name: string;
  type: string;
  displayOrder: number;
  allowsMultipleActiveOrders: boolean;
}>;
type CategoryRow = Readonly<{
  id: string;
  restaurantId: string;
  name: string;
  displayOrder: number;
}>;
type ProductRow = Readonly<{
  id: string;
  restaurantId: string;
  categoryId: string;
  displayOrder: number;
}>;
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
}>;
type ModificationRow = PosOrderingContextModification &
  Readonly<{ restaurantId: string; productVersionId: string }>;

function assembleContext(rows: RawContext): PosOrderingContext {
  const restaurants = rows.restaurants.map(mapRestaurant);
  const catalogs = rows.catalogs.map(mapCatalog);
  const locations = rows.locations.map(mapLocation);
  const categories = rows.categories.map(mapCategory);
  const products = rows.products.map(mapProduct);
  const versions = rows.versions.map(mapVersion);
  const options = rows.options.map(mapModification);
  const removals = rows.removals.map(mapModification);

  assertUniqueIds(restaurants);
  assertUniqueIds(locations);
  assertUniqueIds(categories);
  assertUniqueIds(products);
  assertUniqueIds(versions);
  assertUniqueIds(options);
  assertUniqueIds(removals);
  assertUniqueValues(catalogs.map(({ restaurantId }) => restaurantId));
  assertUniqueValues(
    versions.map(({ restaurantId, productId, versionNumber }) =>
      scopedId(restaurantId, `${productId}:${versionNumber}`),
    ),
  );

  const restaurantIds = new Set(restaurants.map(({ id }) => id));
  const activeCatalogRestaurantIds = new Set(
    catalogs
      .filter(({ restaurantId }) => restaurantIds.has(restaurantId))
      .map(({ restaurantId }) => restaurantId),
  );
  const categoryRestaurantById = new Map(
    categories.map(({ id, restaurantId }) => [id, restaurantId]),
  );
  const productRestaurantById = new Map(
    products.map(({ id, restaurantId }) => [id, restaurantId]),
  );
  const versionRestaurantById = new Map(
    versions.map(({ id, restaurantId }) => [id, restaurantId]),
  );

  for (const product of products) {
    const categoryRestaurantId = categoryRestaurantById.get(product.categoryId);
    if (
      categoryRestaurantId !== undefined &&
      categoryRestaurantId !== product.restaurantId
    ) {
      throw new Error();
    }
  }
  for (const version of versions) {
    const productRestaurantId = productRestaurantById.get(version.productId);
    if (
      productRestaurantId !== undefined &&
      productRestaurantId !== version.restaurantId
    ) {
      throw new Error();
    }
  }
  for (const modification of [...options, ...removals]) {
    const versionRestaurantId = versionRestaurantById.get(
      modification.productVersionId,
    );
    if (
      versionRestaurantId === undefined ||
      versionRestaurantId !== modification.restaurantId
    ) {
      throw new Error();
    }
  }

  const includedCategories = categories.filter(
    ({ restaurantId }) =>
      restaurantIds.has(restaurantId) &&
      activeCatalogRestaurantIds.has(restaurantId),
  );
  const includedCategoryKeys = new Set(
    includedCategories.map(({ restaurantId, id }) =>
      scopedId(restaurantId, id),
    ),
  );
  const includedProducts = products.filter(({ restaurantId, categoryId }) =>
    includedCategoryKeys.has(scopedId(restaurantId, categoryId)),
  );

  const latestVersions = new Map<string, VersionRow>();
  for (const version of versions) {
    const key = scopedId(version.restaurantId, version.productId);
    const current = latestVersions.get(key);
    if (!current || version.versionNumber > current.versionNumber) {
      latestVersions.set(key, version);
    }
  }

  const optionGroups = groupModifications(options);
  const removalGroups = groupModifications(removals);
  const productsByCategory = new Map<string, PosOrderingContextProduct[]>();
  for (const product of includedProducts) {
    const version = latestVersions.get(
      scopedId(product.restaurantId, product.id),
    );
    if (!version) throw new Error();

    const versionKey = scopedId(product.restaurantId, version.id);
    const mapped = mapIncludedProduct(
      product,
      version,
      optionGroups.get(versionKey) ?? [],
      removalGroups.get(versionKey) ?? [],
    );
    const categoryKey = scopedId(product.restaurantId, product.categoryId);
    const group = productsByCategory.get(categoryKey) ?? [];
    group.push(mapped);
    productsByCategory.set(categoryKey, group);
  }

  for (const group of productsByCategory.values()) group.sort(compareNamed);

  const categoriesByRestaurant = new Map<
    string,
    PosOrderingContextCategory[]
  >();
  for (const category of includedCategories) {
    const mapped = Object.freeze({
      id: category.id,
      name: category.name,
      displayOrder: category.displayOrder,
      products: Object.freeze(
        productsByCategory.get(scopedId(category.restaurantId, category.id)) ??
          [],
      ),
    });
    const group = categoriesByRestaurant.get(category.restaurantId) ?? [];
    group.push(mapped);
    categoriesByRestaurant.set(category.restaurantId, group);
  }
  for (const group of categoriesByRestaurant.values()) group.sort(compareNamed);

  const locationsByRestaurant = new Map<
    string,
    PosOrderingContextServiceLocation[]
  >();
  for (const location of locations) {
    if (!restaurantIds.has(location.restaurantId)) continue;
    const mapped = Object.freeze({
      id: location.id,
      name: location.name,
      type: location.type,
      displayOrder: location.displayOrder,
      allowsMultipleActiveOrders: location.allowsMultipleActiveOrders,
    });
    const group = locationsByRestaurant.get(location.restaurantId) ?? [];
    group.push(mapped);
    locationsByRestaurant.set(location.restaurantId, group);
  }
  for (const group of locationsByRestaurant.values()) group.sort(compareNamed);

  const result: PosOrderingContextRestaurant[] = restaurants.map((restaurant) =>
    Object.freeze({
      id: restaurant.id,
      name: restaurant.name,
      serviceLocations: Object.freeze(
        locationsByRestaurant.get(restaurant.id) ?? [],
      ),
      categories: Object.freeze(
        categoriesByRestaurant.get(restaurant.id) ?? [],
      ),
    }),
  );
  result.sort((left, right) =>
    compareNameThenId(left.name, left.id, right.name, right.id),
  );

  return Object.freeze({ restaurants: Object.freeze(result) });
}

function mapIncludedProduct(
  product: ProductRow,
  version: VersionRow,
  options: readonly PosOrderingContextModification[],
  removals: readonly PosOrderingContextModification[],
): PosOrderingContextProduct {
  if (
    version.restaurantId !== product.restaurantId ||
    version.productId !== product.id
  ) {
    throw new Error();
  }
  return Object.freeze({
    id: product.id,
    productVersionId: version.id,
    versionNumber: version.versionNumber,
    name: version.name,
    printerAlias: version.printerAlias,
    displayOrder: product.displayOrder,
    unitPrice: version.unitPrice,
    tax: Object.freeze({
      taxRateId: version.taxRateId,
      code: version.taxCode,
      name: version.taxName,
      rate: version.taxRate,
      priceIncludesTax: version.priceIncludesTax,
    }),
    options: Object.freeze([...options]),
    removableIngredients: Object.freeze([...removals]),
  });
}

function groupModifications(rows: readonly ModificationRow[]) {
  const groups = new Map<string, PosOrderingContextModification[]>();
  for (const row of rows) {
    const key = scopedId(row.restaurantId, row.productVersionId);
    const group = groups.get(key) ?? [];
    group.push(
      Object.freeze({
        id: row.id,
        name: row.name,
        priceAdjustment: row.priceAdjustment,
        displayOrder: row.displayOrder,
      }),
    );
    groups.set(key, group);
  }
  for (const group of groups.values()) group.sort(compareNamed);
  return groups;
}

function compareNamed(
  left: Readonly<{ id: string; name: string; displayOrder: number }>,
  right: Readonly<{ id: string; name: string; displayOrder: number }>,
) {
  return (
    left.displayOrder - right.displayOrder ||
    compareNameThenId(left.name, left.id, right.name, right.id)
  );
}

function compareNameThenId(
  leftName: string,
  leftId: string,
  rightName: string,
  rightId: string,
) {
  return (
    leftName.localeCompare(rightName, "es") || leftId.localeCompare(rightId)
  );
}

function mapRestaurant(row: unknown): RestaurantRow {
  if (!isRecord(row) || !isUuid(row.id) || !isNonblank(row.name)) {
    throw new Error();
  }
  return Object.freeze({ id: row.id, name: row.name });
}

function mapCatalog(row: unknown): CatalogRow {
  if (!isRecord(row) || !isUuid(row.restaurant_id)) throw new Error();
  return Object.freeze({ restaurantId: row.restaurant_id });
}

function mapLocation(row: unknown): LocationRow {
  if (
    !isRecord(row) ||
    !isUuid(row.id) ||
    !isUuid(row.restaurant_id) ||
    !isNonblank(row.name) ||
    !isNonblank(row.type) ||
    !isDisplayOrder(row.display_order) ||
    typeof row.allows_multiple_active_orders !== "boolean"
  ) {
    throw new Error();
  }
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    type: row.type,
    displayOrder: row.display_order,
    allowsMultipleActiveOrders: row.allows_multiple_active_orders,
  });
}

function mapCategory(row: unknown): CategoryRow {
  if (
    !isRecord(row) ||
    !isUuid(row.id) ||
    !isUuid(row.restaurant_id) ||
    !isNonblank(row.name) ||
    !isDisplayOrder(row.display_order)
  ) {
    throw new Error();
  }
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    displayOrder: row.display_order,
  });
}

function mapProduct(row: unknown): ProductRow {
  if (
    !isRecord(row) ||
    !isUuid(row.id) ||
    !isUuid(row.restaurant_id) ||
    !isUuid(row.category_id) ||
    !isDisplayOrder(row.display_order)
  ) {
    throw new Error();
  }
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    categoryId: row.category_id,
    displayOrder: row.display_order,
  });
}

function mapVersion(row: unknown): VersionRow {
  if (
    !isRecord(row) ||
    !isUuid(row.id) ||
    !isUuid(row.restaurant_id) ||
    !isUuid(row.product_id) ||
    !Number.isInteger(row.version_number) ||
    (row.version_number as number) < 1 ||
    !isNonblank(row.name) ||
    !isNonblank(row.printer_alias) ||
    !isUuid(row.tax_rate_id) ||
    !isNonblank(row.tax_code) ||
    !isNonblank(row.tax_name) ||
    typeof row.price_includes_tax !== "boolean"
  ) {
    throw new Error();
  }
  const unitPrice = decimal(row.unit_price);
  const taxRate = decimal(row.tax_rate);
  if (unitPrice < 0 || taxRate < 0 || taxRate > 1) throw new Error();
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    productId: row.product_id,
    versionNumber: row.version_number as number,
    name: row.name,
    unitPrice,
    printerAlias: row.printer_alias,
    taxRateId: row.tax_rate_id,
    taxCode: row.tax_code,
    taxName: row.tax_name,
    taxRate,
    priceIncludesTax: row.price_includes_tax,
  });
}

function mapModification(row: unknown): ModificationRow {
  if (
    !isRecord(row) ||
    !isUuid(row.id) ||
    !isUuid(row.restaurant_id) ||
    !isUuid(row.product_version_id) ||
    !isNonblank(row.name) ||
    !isDisplayOrder(row.display_order) ||
    !(row.price_adjustment === null || isDecimal(row.price_adjustment))
  ) {
    throw new Error();
  }
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    productVersionId: row.product_version_id,
    name: row.name,
    priceAdjustment:
      row.price_adjustment === null ? null : decimal(row.price_adjustment),
    displayOrder: row.display_order,
  });
}

function assertUniqueIds(rows: readonly Readonly<{ id: string }>[]) {
  assertUniqueValues(rows.map(({ id }) => id));
}

function assertUniqueValues(values: readonly string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error();
    seen.add(value);
  }
}

function decimal(value: unknown) {
  if (!isDecimal(value)) throw new Error();
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error();
  return parsed;
}

function isDecimal(value: unknown): value is string | number {
  return (
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value))
  );
}

function isDisplayOrder(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function scopedId(restaurantId: string, id: string) {
  return `${restaurantId}:${id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
