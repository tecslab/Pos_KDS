import { err, ok, type Result } from "../../domain";
import type { AuditEventService } from "../audit";

export type ProductCategoryRestaurant = Readonly<{
  id: string;
  name: string;
}>;

export type ProductCategory = Readonly<{
  id: string;
  restaurantId: string;
  restaurantName: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}>;

export type ProductCategoryAdministrationView = Readonly<{
  restaurants: readonly ProductCategoryRestaurant[];
  categories: readonly ProductCategory[];
}>;

export type SaveProductCategoryInput = Readonly<{
  id?: string;
  restaurantId: string;
  name: string;
  displayOrder: string;
  isActive: boolean;
}>;

export interface ProductCategoryAdministrationGateway {
  list(): Promise<ProductCategoryAdministrationView>;
  save(actorId: string, category: ProductCategory): Promise<ProductCategory>;
}

export type ProductCategoryAdministrationError = Readonly<{
  kind: "product-category-administration-error";
  code: "INVALID_INPUT" | "OPERATION_FAILED";
}>;

export class ProductCategoryAdministrationService {
  constructor(
    private readonly gateway: ProductCategoryAdministrationGateway,
    private readonly audit: AuditEventService,
    private readonly createId: () => string,
  ) {}

  async list(): Promise<
    Result<
      ProductCategoryAdministrationView,
      ProductCategoryAdministrationError
    >
  > {
    try {
      const view = await this.gateway.list();
      return ok(
        Object.freeze({
          restaurants: Object.freeze([...view.restaurants]),
          categories: Object.freeze([...view.categories]),
        }),
      );
    } catch {
      return failure("OPERATION_FAILED");
    }
  }

  async save(
    actorId: string,
    input: SaveProductCategoryInput,
  ): Promise<Result<ProductCategory, ProductCategoryAdministrationError>> {
    const normalized = normalize(input, this.createId);
    if (!isUuid(actorId) || normalized === null)
      return failure("INVALID_INPUT");

    try {
      const view = await this.gateway.list();
      const restaurant = view.restaurants.find(
        (item) => item.id === normalized.restaurantId,
      );
      if (!restaurant) return failure("OPERATION_FAILED");

      const current = view.categories.find((item) => item.id === normalized.id);
      if (current && current.restaurantId !== normalized.restaurantId)
        return failure("OPERATION_FAILED");

      const desired = Object.freeze({
        ...normalized,
        restaurantName: current?.restaurantName ?? restaurant.name,
      });
      const audit = await this.audit.record({
        actorId,
        action: actionFor(current, desired),
        entityType: "product_category",
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

function normalize(input: SaveProductCategoryInput, createId: () => string) {
  const id = input.id?.trim() || createId();
  const name = input.name.trim().replace(/\s+/g, " ");
  const displayOrder = /^\d{1,6}$/.test(input.displayOrder)
    ? Number(input.displayOrder)
    : -1;
  if (
    !isUuid(id) ||
    !isUuid(input.restaurantId) ||
    name.length < 1 ||
    name.length > 120 ||
    displayOrder < 0 ||
    displayOrder > 100000
  )
    return null;

  return Object.freeze({
    id,
    restaurantId: input.restaurantId,
    name,
    displayOrder,
    isActive: input.isActive,
  });
}

function actionFor(
  current: ProductCategory | undefined,
  desired: ProductCategory,
) {
  if (!current) return "product_category.created";
  if (current.isActive !== desired.isActive)
    return desired.isActive
      ? "product_category.activated"
      : "product_category.deactivated";
  if (current.displayOrder !== desired.displayOrder)
    return "product_category.reordered";
  return "product_category.updated";
}

function snapshot(category: ProductCategory) {
  return {
    restaurantId: category.restaurantId,
    name: category.name,
    displayOrder: category.displayOrder,
    isActive: category.isActive,
  };
}

function failure(code: ProductCategoryAdministrationError["code"]) {
  return err(
    Object.freeze({
      kind: "product-category-administration-error" as const,
      code,
    }),
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
