import {
  err,
  ok,
  type InventoryPurchaseRegistered,
  type Result,
} from "../../domain";
import type { AuditClock } from "../audit";
import {
  AuthorizationService,
  type AuthorizationProfileReader,
} from "../authorization";
import type { TransactionalOperationRunner } from "../transactional-operation-runner";

const MAX_QUANTITY = BigInt("99999999999999");
const MAX_MONEY = BigInt("999999999999");

export type RegisterInventoryPurchaseLineInput = Readonly<{
  inventoryItemId: string;
  quantity: string;
  unitPrice: string;
}>;

export type RegisterInventoryPurchaseInput = Readonly<{
  restaurantId: string;
  expenseCategoryId: string;
  supplierName?: string | null;
  referenceNumber?: string | null;
  comments?: string | null;
  lines: readonly RegisterInventoryPurchaseLineInput[];
  sourceIp?: string | null;
}>;

export type RegisterInventoryPurchaseCommand = Readonly<{
  actorId: string;
  restaurantId: string;
  expenseCategoryId: string;
  supplierName: string | null;
  referenceNumber: string | null;
  comments: string | null;
  lines: readonly RegisterInventoryPurchaseLineInput[];
  occurredAt: string;
  sourceIp: string | null;
}>;

export type RegisteredInventoryPurchaseLine = Readonly<{
  inventoryItemId: string;
  inventoryMovementId: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  lineTotal: string;
}>;

export type RegisteredInventoryPurchase = Readonly<{
  purchaseId: string;
  restaurantId: string;
  expenseCategoryId: string;
  operatingExpenseId: string;
  recordedById: string;
  supplierName: string | null;
  referenceNumber: string | null;
  comments: string | null;
  totalAmount: string;
  recordedAt: string;
  lines: readonly RegisteredInventoryPurchaseLine[];
}>;

export type InventoryPurchaseRegistrationError = Readonly<{
  kind: "inventory-purchase-registration-error";
  code:
    | "UNAUTHORIZED"
    | "INVALID_PURCHASE"
    | "RESTAURANT_UNAVAILABLE"
    | "INVENTORY_ITEM_UNAVAILABLE"
    | "EXPENSE_CATEGORY_UNAVAILABLE"
    | "OPERATION_FAILED";
}>;

export interface InventoryPurchaseRegistrationGateway {
  register(
    command: RegisterInventoryPurchaseCommand,
  ): Promise<
    Result<RegisteredInventoryPurchase, InventoryPurchaseRegistrationError>
  >;
}

export class InventoryPurchaseRegistrationService {
  constructor(
    private readonly profiles: AuthorizationProfileReader,
    private readonly gateway: InventoryPurchaseRegistrationGateway,
    private readonly clock: AuditClock,
    private readonly operations: TransactionalOperationRunner<InventoryPurchaseRegistered>,
  ) {}

  async register(
    authenticatedUserId: string,
    input: RegisterInventoryPurchaseInput,
  ): Promise<
    Result<RegisteredInventoryPurchase, InventoryPurchaseRegistrationError>
  > {
    if (!isUuid(authenticatedUserId)) return failure("UNAUTHORIZED");

    const authorization = await new AuthorizationService(
      this.profiles,
    ).authorize(authenticatedUserId, "inventory.purchases.register");
    if (!authorization.ok) return failure("UNAUTHORIZED");

    const normalized = normalize(input);
    if (normalized === null) return failure("INVALID_PURCHASE");

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

      const purchase = result.value;
      events.record(
        Object.freeze({
          type: "inventory.purchase.registered" as const,
          occurredAt: purchase.recordedAt,
          payload: Object.freeze({
            purchaseId: purchase.purchaseId,
            restaurantId: purchase.restaurantId,
            operatingExpenseId: purchase.operatingExpenseId,
            totalAmount: purchase.totalAmount,
            recordedAt: purchase.recordedAt,
            lines: Object.freeze(
              purchase.lines.map((line) =>
                Object.freeze({
                  inventoryItemId: line.inventoryItemId,
                  inventoryMovementId: line.inventoryMovementId,
                  quantity: line.quantity,
                  unitOfMeasure: line.unitOfMeasure,
                  unitPrice: line.unitPrice,
                  lineTotal: line.lineTotal,
                }),
              ),
            ),
          }),
        }),
      );
      return result;
    });
  }
}

function normalize(input: RegisterInventoryPurchaseInput) {
  if (
    !isRecord(input) ||
    !isUuid(input.restaurantId) ||
    !isUuid(input.expenseCategoryId) ||
    !Array.isArray(input.lines) ||
    input.lines.length < 1 ||
    input.lines.length > 100
  ) {
    return null;
  }

  const supplierName = optionalText(input.supplierName, 200);
  const referenceNumber = optionalText(input.referenceNumber, 200);
  const comments = optionalText(input.comments, 2_000);
  const sourceIp = optionalText(input.sourceIp, 64);
  if (
    supplierName === undefined ||
    referenceNumber === undefined ||
    comments === undefined ||
    sourceIp === undefined
  ) {
    return null;
  }

  const itemIds = new Set<string>();
  const lines: RegisterInventoryPurchaseLineInput[] = [];
  for (const line of input.lines) {
    if (!isRecord(line) || !isUuid(line.inventoryItemId)) return null;
    const quantity = decimal(line.quantity, 3, MAX_QUANTITY);
    const unitPrice = decimal(line.unitPrice, 2, MAX_MONEY);
    if (
      quantity === null ||
      quantity === "0.000" ||
      unitPrice === null ||
      unitPrice === "0.00" ||
      itemIds.has(line.inventoryItemId)
    ) {
      return null;
    }
    itemIds.add(line.inventoryItemId);
    lines.push(
      Object.freeze({
        inventoryItemId: line.inventoryItemId,
        quantity,
        unitPrice,
      }),
    );
  }
  lines.sort((left, right) =>
    left.inventoryItemId.localeCompare(right.inventoryItemId),
  );

  return Object.freeze({
    restaurantId: input.restaurantId,
    expenseCategoryId: input.expenseCategoryId,
    supplierName,
    referenceNumber,
    comments,
    lines: Object.freeze(lines),
    sourceIp,
  });
}

function decimal(value: unknown, scale: number, maximum: bigint) {
  if (
    typeof value !== "string" ||
    !new RegExp(
      `^\\d{1,${scale === 3 ? 11 : 10}}(?:\\.\\d{1,${scale}})?$`,
    ).test(value)
  ) {
    return null;
  }
  const [integer, fraction = ""] = value.split(".");
  const scaled =
    BigInt(integer) * BigInt(10 ** scale) +
    BigInt((fraction + "0".repeat(scale)).slice(0, scale));
  if (scaled > maximum) return null;
  const canonical = scaled.toString().padStart(scale + 1, "0");
  return `${canonical.slice(0, -scale)}.${canonical.slice(-scale)}`;
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

export function inventoryPurchaseRegistrationFailure(
  code: InventoryPurchaseRegistrationError["code"],
): Result<never, InventoryPurchaseRegistrationError> {
  return failure(code);
}

export function registeredInventoryPurchaseResult(
  purchase: RegisteredInventoryPurchase,
) {
  return ok(purchase);
}

function failure(code: InventoryPurchaseRegistrationError["code"]) {
  return err(
    Object.freeze({
      kind: "inventory-purchase-registration-error" as const,
      code,
    }),
  );
}
