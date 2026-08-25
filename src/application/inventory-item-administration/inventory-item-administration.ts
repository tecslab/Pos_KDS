import { err, ok, type Result } from "../../domain";
import type { AuditEventService } from "../audit";

export type InventoryItemType =
  "RAW_INGREDIENT" | "PRODUCED_ITEM" | "RESALE_ITEM";

export type InventoryItemAdministrationRestaurant = Readonly<{
  id: string;
  name: string;
}>;

export type InventoryItem = Readonly<{
  id: string;
  restaurantId: string;
  restaurantName: string;
  name: string;
  type: InventoryItemType;
  unitOfMeasure: string;
  minimumStockLevel: number;
  currentStock: number;
  isActive: boolean;
  identityLocked: boolean;
}>;

export type InventoryItemAdministrationView = Readonly<{
  restaurants: readonly InventoryItemAdministrationRestaurant[];
  items: readonly InventoryItem[];
}>;

export type SaveInventoryItemInput = Readonly<{
  id?: string;
  restaurantId: string;
  name: string;
  type: string;
  unitOfMeasure: string;
  minimumStockLevel: string;
  isActive: boolean;
}>;

export interface InventoryItemAdministrationGateway {
  list(): Promise<InventoryItemAdministrationView>;
  save(actorId: string, item: InventoryItem): Promise<InventoryItem>;
}

export type InventoryItemAdministrationError = Readonly<{
  kind: "inventory-item-administration-error";
  code: "INVALID_INPUT" | "OPERATION_FAILED";
}>;

export class InventoryItemAdministrationService {
  constructor(
    private readonly gateway: InventoryItemAdministrationGateway,
    private readonly audit: AuditEventService,
    private readonly createId: () => string,
  ) {}

  async list(): Promise<
    Result<InventoryItemAdministrationView, InventoryItemAdministrationError>
  > {
    try {
      const view = await this.gateway.list();
      return ok(
        Object.freeze({
          restaurants: Object.freeze([...view.restaurants]),
          items: Object.freeze([...view.items]),
        }),
      );
    } catch {
      return failure("OPERATION_FAILED");
    }
  }

  async save(
    actorId: string,
    input: SaveInventoryItemInput,
  ): Promise<Result<InventoryItem, InventoryItemAdministrationError>> {
    const normalized = normalize(input, this.createId);
    if (!isUuid(actorId) || normalized === null)
      return failure("INVALID_INPUT");

    try {
      const view = await this.gateway.list();
      const restaurant = view.restaurants.find(
        (item) => item.id === normalized.restaurantId,
      );
      if (!restaurant) return failure("OPERATION_FAILED");

      const current = view.items.find((item) => item.id === normalized.id);
      if (
        current &&
        (current.restaurantId !== normalized.restaurantId ||
          (current.identityLocked &&
            (current.type !== normalized.type ||
              current.unitOfMeasure !== normalized.unitOfMeasure)))
      )
        return failure("OPERATION_FAILED");

      const desired: InventoryItem = Object.freeze({
        ...normalized,
        restaurantName: current?.restaurantName ?? restaurant.name,
        currentStock: current?.currentStock ?? 0,
        identityLocked: current?.identityLocked ?? false,
      });
      const audit = await this.audit.record({
        actorId,
        action: actionFor(current, desired),
        entityType: "inventory_item",
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

function normalize(input: SaveInventoryItemInput, createId: () => string) {
  const id = input.id?.trim() || createId();
  const restaurantId = input.restaurantId.trim();
  const name = collapseWhitespace(input.name);
  const unitOfMeasure = collapseWhitespace(input.unitOfMeasure);
  const type = isInventoryItemType(input.type) ? input.type : null;
  const minimumStockLevel = parseQuantity(input.minimumStockLevel);
  if (
    !isUuid(id) ||
    !isUuid(restaurantId) ||
    type === null ||
    name.length < 1 ||
    name.length > 120 ||
    unitOfMeasure.length < 1 ||
    unitOfMeasure.length > 40 ||
    minimumStockLevel === null
  )
    return null;

  return Object.freeze({
    id,
    restaurantId,
    name,
    type,
    unitOfMeasure,
    minimumStockLevel,
    isActive: input.isActive,
  });
}

function parseQuantity(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(normalized)) return null;
  const quantity = Number(normalized);
  return Number.isFinite(quantity) && quantity <= 99999999999.999
    ? quantity
    : null;
}

function actionFor(current: InventoryItem | undefined, desired: InventoryItem) {
  if (!current) return "inventory_item.created";
  if (current.isActive !== desired.isActive)
    return desired.isActive
      ? "inventory_item.activated"
      : "inventory_item.deactivated";
  return "inventory_item.updated";
}

function snapshot(item: InventoryItem) {
  return {
    restaurantId: item.restaurantId,
    name: item.name,
    type: item.type,
    unitOfMeasure: item.unitOfMeasure,
    minimumStockLevel: item.minimumStockLevel,
    isActive: item.isActive,
  };
}

function isInventoryItemType(value: string): value is InventoryItemType {
  return ["RAW_INGREDIENT", "PRODUCED_ITEM", "RESALE_ITEM"].includes(value);
}

function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function failure(code: InventoryItemAdministrationError["code"]) {
  return err(
    Object.freeze({
      kind: "inventory-item-administration-error" as const,
      code,
    }),
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
