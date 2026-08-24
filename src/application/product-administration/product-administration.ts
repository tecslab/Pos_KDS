import { err, ok, type Result } from "../../domain";
import type { AuditEventService, JsonObject } from "../audit";

export type ProductAdministrationRestaurant = Readonly<{
  id: string;
  name: string;
}>;

export type ProductAdministrationCategory = Readonly<{
  id: string;
  restaurantId: string;
  name: string;
  isActive: boolean;
}>;

export type ProductAdministrationTaxRate = Readonly<{
  id: string;
  restaurantId: string;
  code: string;
  name: string;
  rate: number;
  isActive: boolean;
}>;

export type ProductAdministrationRecipe = Readonly<{
  id: string;
  restaurantId: string;
  productId: string;
  name: string;
}>;

export type ProductAdministrationResaleItem = Readonly<{
  id: string;
  restaurantId: string;
  name: string;
  unitOfMeasure: string;
}>;

export type ProductModification = Readonly<{
  id: string;
  name: string;
  priceAdjustment: number | null;
  displayOrder: number;
}>;

export type Product = Readonly<{
  id: string;
  restaurantId: string;
  restaurantName: string;
  categoryId: string;
  categoryName: string;
  displayOrder: number;
  isActive: boolean;
  versionId: string;
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
  options: readonly ProductModification[];
  removableIngredients: readonly ProductModification[];
}>;

export type ProductAdministrationView = Readonly<{
  restaurants: readonly ProductAdministrationRestaurant[];
  categories: readonly ProductAdministrationCategory[];
  taxRates: readonly ProductAdministrationTaxRate[];
  recipes: readonly ProductAdministrationRecipe[];
  resaleItems: readonly ProductAdministrationResaleItem[];
  products: readonly Product[];
}>;

export type SaveProductInput = Readonly<{
  id?: string;
  restaurantId: string;
  categoryId: string;
  displayOrder: string;
  isActive: boolean;
  name: string;
  unitPrice: string;
  printerAlias: string;
  taxRateId: string;
  priceIncludesTax: boolean;
  recipeId?: string;
  resaleInventoryItemId?: string;
  optionLines: string;
  removableIngredientLines: string;
}>;

export interface ProductAdministrationGateway {
  list(): Promise<ProductAdministrationView>;
  save(actorId: string, product: Product): Promise<Product>;
}

export type ProductAdministrationError = Readonly<{
  kind: "product-administration-error";
  code: "INVALID_INPUT" | "OPERATION_FAILED";
}>;

export class ProductAdministrationService {
  constructor(
    private readonly gateway: ProductAdministrationGateway,
    private readonly audit: AuditEventService,
    private readonly createId: () => string,
  ) {}

  async list(): Promise<
    Result<ProductAdministrationView, ProductAdministrationError>
  > {
    try {
      const view = await this.gateway.list();
      return ok(freezeView(view));
    } catch {
      return failure("OPERATION_FAILED");
    }
  }

  async save(
    actorId: string,
    input: SaveProductInput,
  ): Promise<Result<Product, ProductAdministrationError>> {
    if (!isUuid(actorId)) return failure("INVALID_INPUT");

    try {
      const view = await this.gateway.list();
      const current = input.id
        ? view.products.find((product) => product.id === input.id?.trim())
        : undefined;
      const normalized = normalize(input, current, this.createId);
      if (normalized === null) return failure("INVALID_INPUT");

      const restaurant = view.restaurants.find(
        (item) => item.id === normalized.restaurantId,
      );
      const category = view.categories.find(
        (item) =>
          item.id === normalized.categoryId &&
          item.restaurantId === normalized.restaurantId,
      );
      const taxRate = view.taxRates.find(
        (item) =>
          item.id === normalized.taxRateId &&
          item.restaurantId === normalized.restaurantId,
      );
      if (
        !restaurant ||
        !category ||
        !taxRate ||
        (current && current.restaurantId !== normalized.restaurantId)
      )
        return failure("OPERATION_FAILED");

      if (
        normalized.recipeId !== null &&
        !view.recipes.some(
          (recipe) =>
            recipe.id === normalized.recipeId &&
            recipe.restaurantId === normalized.restaurantId &&
            recipe.productId === normalized.id,
        )
      )
        return failure("OPERATION_FAILED");

      if (
        normalized.resaleInventoryItemId !== null &&
        !view.resaleItems.some(
          (item) =>
            item.id === normalized.resaleInventoryItemId &&
            item.restaurantId === normalized.restaurantId,
        )
      )
        return failure("OPERATION_FAILED");

      const desired: Product = Object.freeze({
        ...normalized,
        restaurantName: restaurant.name,
        categoryName: category.name,
        taxCode: taxRate.code,
        taxName: taxRate.name,
        taxRate: taxRate.rate,
      });
      const audit = await this.audit.record({
        actorId,
        action: actionFor(current, desired),
        entityType: "product",
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
  input: SaveProductInput,
  current: Product | undefined,
  createId: () => string,
) {
  const id = input.id?.trim() || createId();
  const restaurantId = input.restaurantId.trim();
  const categoryId = input.categoryId.trim();
  const taxRateId = input.taxRateId.trim();
  const recipeId = input.recipeId?.trim() || null;
  const resaleInventoryItemId = input.resaleInventoryItemId?.trim() || null;
  const name = collapseWhitespace(input.name);
  const printerAlias = collapseWhitespace(input.printerAlias);
  const displayOrder = parseWholeNumber(input.displayOrder);
  const unitPrice = parseMoney(input.unitPrice, false);
  const options = parseModifications(input.optionLines, createId);
  const removableIngredients = parseModifications(
    input.removableIngredientLines,
    createId,
  );
  const versionId = createId();

  if (
    ![id, restaurantId, categoryId, taxRateId, versionId].every(isUuid) ||
    (recipeId !== null && !isUuid(recipeId)) ||
    (resaleInventoryItemId !== null && !isUuid(resaleInventoryItemId)) ||
    (recipeId !== null && resaleInventoryItemId !== null) ||
    name.length < 1 ||
    name.length > 120 ||
    printerAlias.length < 1 ||
    printerAlias.length > 120 ||
    displayOrder === null ||
    unitPrice === null ||
    options === null ||
    removableIngredients === null
  )
    return null;

  return Object.freeze({
    id,
    restaurantId,
    categoryId,
    displayOrder,
    isActive: input.isActive,
    versionId,
    versionNumber: (current?.versionNumber ?? 0) + 1,
    name,
    unitPrice,
    printerAlias,
    taxRateId,
    priceIncludesTax: input.priceIncludesTax,
    recipeId,
    resaleInventoryItemId,
    options,
    removableIngredients,
  });
}

function parseModifications(value: string, createId: () => string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 100) return null;

  const names = new Set<string>();
  const modifications: ProductModification[] = [];
  for (const [displayOrder, line] of lines.entries()) {
    const fields = line.split("|");
    if (fields.length > 2) return null;
    const name = collapseWhitespace(fields[0] ?? "");
    const canonicalName = name.toLocaleLowerCase("es");
    const rawAdjustment = fields[1]?.trim() ?? "";
    const priceAdjustment =
      rawAdjustment === "" ? null : parseMoney(rawAdjustment, true);
    const id = createId();
    if (
      !isUuid(id) ||
      name.length < 1 ||
      name.length > 120 ||
      names.has(canonicalName) ||
      (priceAdjustment === null && rawAdjustment !== "")
    )
      return null;
    names.add(canonicalName);
    modifications.push(
      Object.freeze({ id, name, priceAdjustment, displayOrder }),
    );
  }
  return Object.freeze(modifications);
}

function parseWholeNumber(value: string) {
  return /^\d{1,6}$/.test(value) && Number(value) <= 100000
    ? Number(value)
    : null;
}

function parseMoney(value: string, signed: boolean) {
  const expression = signed
    ? /^-?\d{1,10}(?:\.\d{1,2})?$/
    : /^\d{1,10}(?:\.\d{1,2})?$/;
  if (!expression.test(value)) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function actionFor(current: Product | undefined, desired: Product) {
  if (!current) return "product.created";
  if (current.isActive !== desired.isActive)
    return desired.isActive ? "product.activated" : "product.deactivated";
  return "product.updated";
}

function snapshot(product: Product): JsonObject {
  return {
    restaurantId: product.restaurantId,
    categoryId: product.categoryId,
    displayOrder: product.displayOrder,
    isActive: product.isActive,
    versionId: product.versionId,
    versionNumber: product.versionNumber,
    name: product.name,
    unitPrice: product.unitPrice,
    printerAlias: product.printerAlias,
    taxRateId: product.taxRateId,
    taxCode: product.taxCode,
    taxName: product.taxName,
    taxRate: product.taxRate,
    priceIncludesTax: product.priceIncludesTax,
    recipeId: product.recipeId,
    resaleInventoryItemId: product.resaleInventoryItemId,
    options: product.options,
    removableIngredients: product.removableIngredients,
  };
}

function freezeView(view: ProductAdministrationView) {
  return Object.freeze({
    restaurants: Object.freeze([...view.restaurants]),
    categories: Object.freeze([...view.categories]),
    taxRates: Object.freeze([...view.taxRates]),
    recipes: Object.freeze([...view.recipes]),
    resaleItems: Object.freeze([...view.resaleItems]),
    products: Object.freeze([...view.products]),
  });
}

function failure(code: ProductAdministrationError["code"]) {
  return err(
    Object.freeze({
      kind: "product-administration-error" as const,
      code,
    }),
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
