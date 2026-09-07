import type { SupabaseClient } from "@supabase/supabase-js";

import {
  inventoryPurchaseRegistrationFailure,
  registeredInventoryPurchaseResult,
  type InventoryPurchaseRegistrationGateway,
  type RegisterInventoryPurchaseCommand,
  type RegisteredInventoryPurchase,
  type RegisteredInventoryPurchaseLine,
} from "../../application";

export class SupabaseInventoryPurchaseRegistrationGateway implements InventoryPurchaseRegistrationGateway {
  constructor(private readonly client: SupabaseClient) {}

  async register(command: RegisterInventoryPurchaseCommand) {
    try {
      const { data, error } = await this.client.rpc(
        "register_inventory_purchase",
        {
          actor_user_id: command.actorId,
          target_restaurant_id: command.restaurantId,
          target_expense_category_id: command.expenseCategoryId,
          supplier_name: command.supplierName,
          purchase_reference_number: command.referenceNumber,
          purchase_comments: command.comments,
          purchase_lines_text: JSON.stringify(command.lines),
          audit_occurred_at: command.occurredAt,
          audit_source_ip: command.sourceIp,
        },
      );
      if (error) return mapFailure(error);
      if (!Array.isArray(data) || data.length !== 1) {
        return inventoryPurchaseRegistrationFailure("OPERATION_FAILED");
      }
      const purchase = mapRegisteredInventoryPurchase(data[0]);
      return purchase === null
        ? inventoryPurchaseRegistrationFailure("OPERATION_FAILED")
        : registeredInventoryPurchaseResult(purchase);
    } catch {
      return inventoryPurchaseRegistrationFailure("OPERATION_FAILED");
    }
  }
}

function mapFailure(error: unknown) {
  if (!isRecord(error)) {
    return inventoryPurchaseRegistrationFailure("OPERATION_FAILED");
  }
  if (error.code === "42501") {
    return inventoryPurchaseRegistrationFailure("UNAUTHORIZED");
  }
  if (error.code === "22023") {
    return inventoryPurchaseRegistrationFailure("INVALID_PURCHASE");
  }
  if (typeof error.message === "string") {
    if (error.message.includes("INVENTORY_PURCHASE_RESTAURANT_UNAVAILABLE")) {
      return inventoryPurchaseRegistrationFailure("RESTAURANT_UNAVAILABLE");
    }
    if (error.message.includes("INVENTORY_PURCHASE_ITEM_UNAVAILABLE")) {
      return inventoryPurchaseRegistrationFailure("INVENTORY_ITEM_UNAVAILABLE");
    }
    if (error.message.includes("INVENTORY_PURCHASE_CATEGORY_UNAVAILABLE")) {
      return inventoryPurchaseRegistrationFailure(
        "EXPENSE_CATEGORY_UNAVAILABLE",
      );
    }
  }
  return inventoryPurchaseRegistrationFailure("OPERATION_FAILED");
}

export function mapRegisteredInventoryPurchase(
  value: unknown,
): RegisteredInventoryPurchase | null {
  if (
    !isRecord(value) ||
    !isUuid(value.purchase_id) ||
    !isUuid(value.restaurant_id) ||
    !isUuid(value.expense_category_id) ||
    !isUuid(value.operating_expense_id) ||
    !isUuid(value.recorded_by_id) ||
    !nullableText(value.supplier_name_result) ||
    !nullableText(value.reference_number) ||
    !nullableText(value.comments)
  ) {
    return null;
  }

  const totalAmount = decimal(value.total_amount, 2, false);
  const recordedAt = timestamp(value.recorded_at);
  const lines = mapLines(value.lines);
  if (
    totalAmount === null ||
    totalAmount === "0.00" ||
    recordedAt === null ||
    lines === null
  ) {
    return null;
  }

  const summedTotal = lines.reduce(
    (sum, line) => sum + scaledInteger(line.lineTotal),
    BigInt(0),
  );
  if (summedTotal !== scaledInteger(totalAmount)) return null;

  return Object.freeze({
    purchaseId: value.purchase_id,
    restaurantId: value.restaurant_id,
    expenseCategoryId: value.expense_category_id,
    operatingExpenseId: value.operating_expense_id,
    recordedById: value.recorded_by_id,
    supplierName: value.supplier_name_result,
    referenceNumber: value.reference_number,
    comments: value.comments,
    totalAmount,
    recordedAt,
    lines,
  });
}

function mapLines(
  value: unknown,
): readonly RegisteredInventoryPurchaseLine[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return null;
  }
  const itemIds = new Set<string>();
  const movementIds = new Set<string>();
  const lines: RegisteredInventoryPurchaseLine[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !isUuid(candidate.inventoryItemId) ||
      !isUuid(candidate.inventoryMovementId) ||
      itemIds.has(candidate.inventoryItemId) ||
      movementIds.has(candidate.inventoryMovementId) ||
      !isNonblank(candidate.unitOfMeasure)
    ) {
      return null;
    }
    const quantity = decimal(candidate.quantity, 3, false);
    const unitPrice = decimal(candidate.unitPrice, 2, false);
    const lineTotal = decimal(candidate.lineTotal, 2, false);
    if (
      quantity === null ||
      quantity === "0.000" ||
      unitPrice === null ||
      unitPrice === "0.00" ||
      lineTotal === null ||
      lineTotal === "0.00" ||
      calculateLineTotal(quantity, unitPrice) !== lineTotal
    ) {
      return null;
    }
    itemIds.add(candidate.inventoryItemId);
    movementIds.add(candidate.inventoryMovementId);
    lines.push(
      Object.freeze({
        inventoryItemId: candidate.inventoryItemId,
        inventoryMovementId: candidate.inventoryMovementId,
        quantity,
        unitOfMeasure: candidate.unitOfMeasure,
        unitPrice,
        lineTotal,
      }),
    );
  }
  lines.sort((left, right) =>
    left.inventoryItemId.localeCompare(right.inventoryItemId),
  );
  return Object.freeze(lines);
}

function calculateLineTotal(quantity: string, unitPrice: string) {
  const raw = scaledInteger(quantity) * scaledInteger(unitPrice);
  const cents = (raw + BigInt(500)) / BigInt(1_000);
  return fixed(cents, 2);
}

function decimal(value: unknown, scale: number, signed: boolean) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !new RegExp(signed ? "^-?\\d+(?:\\.\\d+)?$" : "^\\d+(?:\\.\\d+)?$").test(
      String(value),
    )
  ) {
    return null;
  }
  const [integer, fraction = ""] = String(value).split(".");
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) {
    return null;
  }
  const negative = integer.startsWith("-");
  const absoluteInteger = negative ? integer.slice(1) : integer;
  const scaled =
    BigInt(absoluteInteger) * BigInt(10 ** scale) +
    BigInt((fraction + "0".repeat(scale)).slice(0, scale));
  return `${negative ? "-" : ""}${fixed(scaled, scale)}`;
}

function fixed(value: bigint, scale: number) {
  const canonical = value.toString().padStart(scale + 1, "0");
  return `${canonical.slice(0, -scale)}.${canonical.slice(-scale)}`;
}

function scaledInteger(value: string) {
  return BigInt(value.replace(".", ""));
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function nullableText(value: unknown): value is string | null {
  return (
    value === null || (typeof value === "string" && value.trim().length > 0)
  );
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
