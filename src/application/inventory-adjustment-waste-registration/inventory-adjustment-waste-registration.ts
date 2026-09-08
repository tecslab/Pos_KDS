import {
  err,
  ok,
  type InventoryAlertChanged,
  type InventoryAlertTransition,
  type InventoryAdjustmentWasteRegistered,
  type Result,
} from "../../domain";
import { recordInventoryAlertEvents } from "../inventory-alerts";
import type { AuditClock } from "../audit";
import {
  AuthorizationService,
  type AuthorizationProfileReader,
} from "../authorization";
import type { TransactionalOperationRunner } from "../transactional-operation-runner";

const MAX_QUANTITY = BigInt("99999999999999");

export type InventoryAdjustmentWasteOperation = "ADJUSTMENT" | "WASTE";

export type RegisterInventoryAdjustmentWasteInput = Readonly<{
  restaurantId: string;
  inventoryItemId: string;
  operation: InventoryAdjustmentWasteOperation;
  quantity: string;
  reason: string;
  sourceIp?: string | null;
}>;

export type RegisterInventoryAdjustmentWasteCommand = Readonly<{
  actorId: string;
  restaurantId: string;
  inventoryItemId: string;
  operation: InventoryAdjustmentWasteOperation;
  quantity: string;
  reason: string;
  occurredAt: string;
  sourceIp: string | null;
}>;

export type RegisteredInventoryAdjustmentWaste = Readonly<{
  originId: string;
  inventoryMovementId: string;
  restaurantId: string;
  inventoryItemId: string;
  operation: InventoryAdjustmentWasteOperation;
  quantityDelta: string;
  unitOfMeasure: string;
  reason: string;
  recordedById: string;
  recordedAt: string;
  previousBalance: string;
  newBalance: string;
}>;

export type PersistedInventoryAdjustmentWasteRegistration =
  RegisteredInventoryAdjustmentWaste &
    Readonly<{
      inventoryAlertTransitions: readonly InventoryAlertTransition[];
    }>;

export type InventoryAdjustmentWasteRegistrationError = Readonly<{
  kind: "inventory-adjustment-waste-registration-error";
  code:
    | "UNAUTHORIZED"
    | "INVALID_MOVEMENT"
    | "RESTAURANT_UNAVAILABLE"
    | "INVENTORY_ITEM_UNAVAILABLE"
    | "NEGATIVE_STOCK_DISALLOWED"
    | "OPERATION_FAILED";
}>;

export interface InventoryAdjustmentWasteRegistrationGateway {
  register(
    command: RegisterInventoryAdjustmentWasteCommand,
  ): Promise<
    Result<
      | RegisteredInventoryAdjustmentWaste
      | PersistedInventoryAdjustmentWasteRegistration,
      InventoryAdjustmentWasteRegistrationError
    >
  >;
}

export class InventoryAdjustmentWasteRegistrationService {
  constructor(
    private readonly profiles: AuthorizationProfileReader,
    private readonly gateway: InventoryAdjustmentWasteRegistrationGateway,
    private readonly clock: AuditClock,
    private readonly operations: TransactionalOperationRunner<
      InventoryAdjustmentWasteRegistered | InventoryAlertChanged
    >,
  ) {}

  async register(
    authenticatedUserId: string,
    input: RegisterInventoryAdjustmentWasteInput,
  ): Promise<
    Result<
      RegisteredInventoryAdjustmentWaste,
      InventoryAdjustmentWasteRegistrationError
    >
  > {
    if (!isUuid(authenticatedUserId) || !isRecord(input)) {
      return failure("UNAUTHORIZED");
    }

    const permission =
      input.operation === "ADJUSTMENT"
        ? "inventory.adjustments.register"
        : input.operation === "WASTE"
          ? "inventory.waste.register"
          : null;
    if (permission === null) return failure("INVALID_MOVEMENT");

    const authorization = await new AuthorizationService(
      this.profiles,
    ).authorize(authenticatedUserId, permission);
    if (!authorization.ok) return failure("UNAUTHORIZED");

    const normalized = normalize(input);
    if (normalized === null) return failure("INVALID_MOVEMENT");

    let occurredAt: string;
    try {
      const now = this.clock.now();
      if (!Number.isFinite(now.getTime())) return failure("OPERATION_FAILED");
      occurredAt = now.toISOString();
    } catch {
      return failure("OPERATION_FAILED");
    }

    return this.operations.run(async (events) => {
      const result = await this.gateway.register(
        Object.freeze({
          actorId: authorization.value.userId,
          ...normalized,
          occurredAt,
        }),
      );
      if (!result.ok) return result;

      const movement =
        "inventoryAlertTransitions" in result.value
          ? withoutInventoryAlertTransitions(result.value)
          : result.value;
      const inventoryAlertTransitions =
        "inventoryAlertTransitions" in result.value
          ? result.value.inventoryAlertTransitions
          : [];
      events.record(
        Object.freeze({
          type:
            movement.operation === "ADJUSTMENT"
              ? ("inventory.adjustment.registered" as const)
              : ("inventory.waste.registered" as const),
          occurredAt: movement.recordedAt,
          payload: Object.freeze({
            originId: movement.originId,
            inventoryMovementId: movement.inventoryMovementId,
            restaurantId: movement.restaurantId,
            inventoryItemId: movement.inventoryItemId,
            quantityDelta: movement.quantityDelta,
            unitOfMeasure: movement.unitOfMeasure,
            recordedAt: movement.recordedAt,
            previousBalance: movement.previousBalance,
            newBalance: movement.newBalance,
          }),
        }),
      );
      recordInventoryAlertEvents(
        events,
        movement.restaurantId,
        inventoryAlertTransitions,
      );
      return registeredInventoryAdjustmentWasteResult(movement);
    });
  }
}

function normalize(input: RegisterInventoryAdjustmentWasteInput) {
  if (!isUuid(input.restaurantId) || !isUuid(input.inventoryItemId))
    return null;
  const quantity = decimal(input.quantity, input.operation === "ADJUSTMENT");
  const reason = requiredText(input.reason, 2_000);
  const sourceIp = optionalText(input.sourceIp, 64);
  if (quantity === null || reason === null || sourceIp === undefined)
    return null;
  return Object.freeze({
    restaurantId: input.restaurantId,
    inventoryItemId: input.inventoryItemId,
    operation: input.operation,
    quantity,
    reason,
    sourceIp,
  });
}

function decimal(value: unknown, signed: boolean) {
  if (
    typeof value !== "string" ||
    !new RegExp(
      signed ? "^-?\\d{1,11}(?:\\.\\d{1,3})?$" : "^\\d{1,11}(?:\\.\\d{1,3})?$",
    ).test(value)
  ) {
    return null;
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction = ""] = unsigned.split(".");
  const scaled =
    BigInt(integer) * BigInt(1_000) + BigInt((fraction + "000").slice(0, 3));
  if (scaled === BigInt(0) || scaled > MAX_QUANTITY) return null;
  const canonical = scaled.toString().padStart(4, "0");
  return `${negative ? "-" : ""}${canonical.slice(0, -3)}.${canonical.slice(-3)}`;
}

function requiredText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 && normalized.length <= maximumLength
    ? normalized
    : null;
}

function optionalText(
  value: unknown,
  maximumLength: number,
): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maximumLength) return undefined;
  return normalized.length === 0 ? null : normalized;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function inventoryAdjustmentWasteRegistrationFailure(
  code: InventoryAdjustmentWasteRegistrationError["code"],
): Result<never, InventoryAdjustmentWasteRegistrationError> {
  return failure(code);
}

export function registeredInventoryAdjustmentWasteResult(
  movement: RegisteredInventoryAdjustmentWaste,
) {
  return ok(movement);
}

export function persistedInventoryAdjustmentWasteRegistrationResult(
  persisted: PersistedInventoryAdjustmentWasteRegistration,
) {
  return ok(persisted);
}

function withoutInventoryAlertTransitions({
  inventoryAlertTransitions: _inventoryAlertTransitions,
  ...movement
}: PersistedInventoryAdjustmentWasteRegistration): RegisteredInventoryAdjustmentWaste {
  void _inventoryAlertTransitions;
  return Object.freeze(movement);
}

function failure(code: InventoryAdjustmentWasteRegistrationError["code"]) {
  return err(
    Object.freeze({
      kind: "inventory-adjustment-waste-registration-error" as const,
      code,
    }),
  );
}
