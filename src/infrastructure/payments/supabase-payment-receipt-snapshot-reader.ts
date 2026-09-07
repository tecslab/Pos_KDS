import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  PaymentReceiptLine,
  PaymentReceiptSnapshot,
  PaymentReceiptSnapshotReader,
  PaymentReceiptSnapshotRequest,
} from "../../application";

const BASKET_RECEIPT_FIELDS = `
  id,
  restaurant_id,
  order_id,
  total_amount,
  order:orders!customer_baskets_order_fkey (
    id,
    restaurant_id,
    order_number,
    restaurant:restaurants!orders_restaurant_fkey (
      id,
      name,
      configuration:restaurant_configurations!restaurant_configurations_restaurant_fkey (
        restaurant_id,
        receipt_header,
        receipt_footer,
        thermal_printer_configuration,
        printing_behavior
      )
    )
  ),
  lines:order_lines (
    id,
    restaurant_id,
    basket_id,
    current_snapshot_id,
    created_at,
    removal:order_line_removals!order_line_removals_line_fkey (
      restaurant_id,
      order_line_id
    ),
    snapshots:order_line_sale_snapshots!order_line_snapshots_line_fkey (
      id,
      restaurant_id,
      order_line_id,
      product_name,
      quantity,
      final_unit_price,
      line_total,
      selected_options,
      removed_ingredients,
      observations
    )
  )
`;

const METHOD_RECEIPT_FIELDS = `
  id,
  restaurant_id,
  receipt_configuration
`;

export class PaymentReceiptSnapshotReadError extends Error {
  constructor() {
    super("The payment receipt snapshot could not be read.");
    this.name = "PaymentReceiptSnapshotReadError";
  }
}

export class SupabasePaymentReceiptSnapshotReader implements PaymentReceiptSnapshotReader {
  constructor(private readonly client: SupabaseClient) {}

  async read(
    request: PaymentReceiptSnapshotRequest,
  ): Promise<PaymentReceiptSnapshot | null> {
    try {
      const [basketResult, methodResult] = await Promise.all([
        this.client
          .from("customer_baskets")
          .select(BASKET_RECEIPT_FIELDS)
          .eq("id", request.basketId)
          .eq("restaurant_id", request.restaurantId)
          .maybeSingle(),
        this.client
          .from("payment_methods")
          .select(METHOD_RECEIPT_FIELDS)
          .eq("id", request.paymentMethodId)
          .eq("restaurant_id", request.restaurantId)
          .maybeSingle(),
      ]);

      if (basketResult.error !== null || methodResult.error !== null) {
        throw new Error();
      }
      if (basketResult.data === null || methodResult.data === null) return null;

      return mapPaymentReceiptSnapshotRows(
        basketResult.data,
        methodResult.data,
        request,
      );
    } catch {
      throw new PaymentReceiptSnapshotReadError();
    }
  }
}

export function mapPaymentReceiptSnapshotRows(
  basketValue: unknown,
  methodValue: unknown,
  request: PaymentReceiptSnapshotRequest,
): PaymentReceiptSnapshot {
  if (!isRecord(basketValue) || !isRecord(methodValue)) return invalid();
  const order = singleRelation(basketValue.order);
  const restaurant = order && singleRelation(order.restaurant);
  const configuration = restaurant
    ? singleOptionalRelation(restaurant.configuration)
    : null;

  if (
    basketValue.id !== request.basketId ||
    basketValue.restaurant_id !== request.restaurantId ||
    basketValue.order_id !== request.orderId ||
    !order ||
    order.id !== request.orderId ||
    order.restaurant_id !== request.restaurantId ||
    !isNonblank(order.order_number) ||
    !restaurant ||
    restaurant.id !== request.restaurantId ||
    !isNonblank(restaurant.name) ||
    (configuration !== null &&
      configuration.restaurant_id !== request.restaurantId) ||
    methodValue.id !== request.paymentMethodId ||
    methodValue.restaurant_id !== request.restaurantId ||
    !Array.isArray(basketValue.lines)
  ) {
    return invalid();
  }

  const basketTotalAmount = money(basketValue.total_amount, true);
  if (basketTotalAmount === null) return invalid();

  const lines = basketValue.lines
    .map((line) => mapLine(line, request))
    .filter((line): line is MappedLine => line !== null)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.value.id.localeCompare(right.value.id),
    );
  if (
    lines.length === 0 ||
    sumMoney(lines.map((line) => line.value.lineTotal)) !== basketTotalAmount
  ) {
    return invalid();
  }

  const restaurantHeader = configuredText(configuration?.receipt_header);
  const restaurantFooter = configuredText(configuration?.receipt_footer);
  const methodReceipt = optionalRecord(methodValue.receipt_configuration);
  if (
    restaurantHeader === undefined ||
    restaurantFooter === undefined ||
    methodReceipt === undefined
  ) {
    return invalid();
  }
  const methodHeader = configuredText(methodReceipt?.header);
  const methodFooter = configuredText(methodReceipt?.footer);
  if (methodHeader === undefined || methodFooter === undefined)
    return invalid();

  return Object.freeze({
    restaurantId: request.restaurantId,
    restaurantName: restaurant.name,
    orderId: request.orderId,
    orderNumber: order.order_number,
    basketId: request.basketId,
    basketTotalAmount,
    receiptHeader: methodHeader ?? restaurantHeader,
    receiptFooter: methodFooter ?? restaurantFooter,
    printer: mapPrinterConfiguration(configuration),
    lines: Object.freeze(lines.map((line) => line.value)),
  });
}

type MappedLine = Readonly<{ createdAt: string; value: PaymentReceiptLine }>;

function mapLine(
  value: unknown,
  request: PaymentReceiptSnapshotRequest,
): MappedLine | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    value.restaurant_id !== request.restaurantId ||
    value.basket_id !== request.basketId ||
    !isUuid(value.current_snapshot_id) ||
    !Array.isArray(value.snapshots)
  ) {
    return invalid();
  }

  const removal = singleOptionalRelation(value.removal);
  if (removal !== null) {
    if (
      removal.restaurant_id !== request.restaurantId ||
      removal.order_line_id !== value.id
    ) {
      return invalid();
    }
    return null;
  }

  const matching = value.snapshots.filter(
    (snapshot) =>
      isRecord(snapshot) && snapshot.id === value.current_snapshot_id,
  );
  if (matching.length !== 1) return invalid();
  const snapshot = matching[0];
  if (
    !isRecord(snapshot) ||
    !isUuid(snapshot.id) ||
    snapshot.restaurant_id !== request.restaurantId ||
    snapshot.order_line_id !== value.id ||
    !isNonblank(snapshot.product_name) ||
    !Number.isSafeInteger(snapshot.quantity) ||
    Number(snapshot.quantity) < 1 ||
    !optionalText(snapshot.observations, 2_000)
  ) {
    return invalid();
  }

  const finalUnitPrice = money(snapshot.final_unit_price, false);
  const lineTotal = money(snapshot.line_total, false);
  const selectedOptions = modificationNames(snapshot.selected_options);
  const removedIngredients = modificationNames(snapshot.removed_ingredients);
  const createdAt = timestamp(value.created_at);
  if (
    finalUnitPrice === null ||
    lineTotal === null ||
    selectedOptions === null ||
    removedIngredients === null ||
    createdAt === null ||
    cents(finalUnitPrice) * BigInt(Number(snapshot.quantity)) !==
      cents(lineTotal)
  ) {
    return invalid();
  }

  return Object.freeze({
    createdAt,
    value: Object.freeze({
      id: value.id,
      productName: snapshot.product_name,
      quantity: Number(snapshot.quantity),
      finalUnitPrice,
      lineTotal,
      selectedOptions,
      removedIngredients,
      observations: snapshot.observations as string | null,
    }),
  });
}

function mapPrinterConfiguration(
  configuration: Record<string, unknown> | null,
) {
  if (configuration === null) {
    return Object.freeze({ enabled: false, destinationId: null });
  }
  const behavior = optionalRecord(configuration.printing_behavior);
  const thermal = optionalRecord(configuration.thermal_printer_configuration);
  if (behavior === undefined || thermal === undefined) return invalid();

  const receiptBehavior = optionalRecord(behavior?.paymentReceipts);
  const receiptPrinter = optionalRecord(thermal?.paymentReceipts);
  if (receiptBehavior === undefined || receiptPrinter === undefined) {
    return invalid();
  }
  if (receiptBehavior === null) {
    return Object.freeze({ enabled: false, destinationId: null });
  }
  if (typeof receiptBehavior.enabled !== "boolean") return invalid();
  if (!receiptBehavior.enabled) {
    return Object.freeze({ enabled: false, destinationId: null });
  }

  const destinationId = receiptPrinter?.destinationId;
  if (destinationId === undefined || destinationId === null) {
    return Object.freeze({ enabled: true, destinationId: null });
  }
  if (!isNonblank(destinationId) || destinationId.length > 200)
    return invalid();
  return Object.freeze({ enabled: true, destinationId });
}

function modificationNames(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const names: string[] = [];
  for (const modification of value) {
    if (!isRecord(modification) || !isNonblank(modification.name)) return null;
    names.push(modification.name);
  }
  return Object.freeze(names);
}

function optionalRecord(
  value: unknown,
): Record<string, unknown> | null | undefined {
  if (value === undefined || value === null) return null;
  return isRecord(value) ? value : undefined;
}

function configuredText(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" && value.length <= 500 ? value : undefined;
}

function optionalText(value: unknown, maximumLength: number) {
  return (
    value === null ||
    (typeof value === "string" && value.length <= maximumLength)
  );
}

function money(value: unknown, positive: boolean): string | null {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+(?:\.\d+)?$/.test(String(value))
  ) {
    return null;
  }
  const [integer, fraction = ""] = String(value).split(".");
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) return null;
  const amount =
    BigInt(integer) * BigInt(100) +
    BigInt((fraction.slice(0, 2) + "00").slice(0, 2));
  if (amount > BigInt("999999999999") || (positive && amount === BigInt(0))) {
    return null;
  }
  return formatCents(amount);
}

function sumMoney(values: readonly string[]) {
  return formatCents(
    values.reduce((total, value) => total + cents(value), BigInt(0)),
  );
}

function cents(value: string) {
  return BigInt(value.replace(".", ""));
}

function formatCents(value: bigint) {
  const canonical = value.toString().padStart(3, "0");
  return `${canonical.slice(0, -2)}.${canonical.slice(-2)}`;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function singleRelation(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) {
    return value[0];
  }
  return null;
}

function singleOptionalRelation(
  value: unknown,
): Record<string, unknown> | null {
  if (value === null || (Array.isArray(value) && value.length === 0))
    return null;
  return singleRelation(value);
}

function invalid(): never {
  throw new PaymentReceiptSnapshotReadError();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
