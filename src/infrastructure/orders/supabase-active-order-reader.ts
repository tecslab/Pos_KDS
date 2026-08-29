import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ACTIVE_ORDER_STATUSES,
  type ActiveOrderBasket,
  type ActiveOrderBasketStatus,
  type ActiveOrderBasketSummary,
  type ActiveOrderDetail,
  type ActiveOrderLine,
  type ActiveOrderLineSnapshot,
  type ActiveOrderListItem,
  type ActiveOrderModificationSnapshot,
  type ActiveOrderReader,
  type ActiveOrderStatus,
} from "../../application";

const ORDER_BASE_FIELDS = `
  id,
  restaurant_id,
  order_number,
  status,
  notes,
  total_amount,
  created_at,
  updated_at,
  service_location:service_locations!orders_service_location_fkey (
    id,
    restaurant_id,
    name,
    type
  ),
  assigned_waiter:application_users!orders_assigned_waiter_fkey (
    id,
    display_name
  )
`;

const ORDER_SUMMARY_FIELDS = `
  ${ORDER_BASE_FIELDS},
  baskets:customer_baskets (
    id,
    restaurant_id,
    status,
    total_amount,
    created_at,
    paid_at,
    payments (restaurant_id, amount),
    lines:order_lines (
      id,
      restaurant_id,
      removal:order_line_removals!order_line_removals_line_fkey (
        restaurant_id,
        order_line_id
      )
    )
  )
`;

const ORDER_DETAIL_FIELDS = `
  ${ORDER_BASE_FIELDS},
  ready_at,
  on_the_way_at,
  delivered_at,
  paid_at,
  baskets:customer_baskets (
    id,
    restaurant_id,
    status,
    total_amount,
    created_at,
    paid_at,
    payments (restaurant_id, amount),
    lines:order_lines (
      id,
      restaurant_id,
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
        revision_number,
        product_version_id,
        product_name,
        quantity,
        base_unit_price,
        final_unit_price,
        line_total,
        tax_code,
        tax_name,
        tax_rate,
        price_includes_tax,
        selected_options,
        removed_ingredients,
        observations,
        created_at
      )
    )
  )
`;

export class ActiveOrderReadError extends Error {
  constructor() {
    super("Active orders could not be read.");
    this.name = "ActiveOrderReadError";
  }
}

export class SupabaseActiveOrderReader implements ActiveOrderReader {
  constructor(private readonly client: SupabaseClient) {}

  async listByStatuses(
    statuses: readonly ActiveOrderStatus[],
  ): Promise<readonly ActiveOrderListItem[]> {
    assertActiveStatuses(statuses);

    try {
      const { data, error } = await this.client
        .from("orders")
        .select(ORDER_SUMMARY_FIELDS)
        .in("status", [...statuses])
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      if (error !== null || !Array.isArray(data)) throw new Error();
      return Object.freeze(data.map(mapActiveOrderListRow));
    } catch {
      throw new ActiveOrderReadError();
    }
  }

  async findByIdAndStatuses(
    orderId: string,
    statuses: readonly ActiveOrderStatus[],
  ): Promise<ActiveOrderDetail | null> {
    assertActiveStatuses(statuses);

    try {
      const { data, error } = await this.client
        .from("orders")
        .select(ORDER_DETAIL_FIELDS)
        .eq("id", orderId)
        .in("status", [...statuses])
        .maybeSingle();

      if (error !== null) throw new Error();
      return data === null ? null : mapActiveOrderDetailRow(data);
    } catch {
      throw new ActiveOrderReadError();
    }
  }
}

export function mapActiveOrderListRow(value: unknown): ActiveOrderListItem {
  const common = mapCommonOrder(value, false);
  return Object.freeze({
    ...common.base,
    baskets: Object.freeze(common.baskets),
  });
}

export function mapActiveOrderDetailRow(value: unknown): ActiveOrderDetail {
  const common = mapCommonOrder(value, true);
  if (!isRecord(value)) throw new ActiveOrderReadError();

  return Object.freeze({
    ...common.base,
    readyAt: nullableTimestamp(value.ready_at),
    onTheWayAt: nullableTimestamp(value.on_the_way_at),
    deliveredAt: nullableTimestamp(value.delivered_at),
    paidAt: nullableTimestamp(value.paid_at),
    baskets: Object.freeze(common.baskets as ActiveOrderBasket[]),
  });
}

function mapCommonOrder(value: unknown, detailed: boolean) {
  if (!isRecord(value)) throw new ActiveOrderReadError();
  const location = singleRelation(value.service_location);
  const waiter = singleRelation(value.assigned_waiter);
  if (
    !isUuid(value.id) ||
    !isUuid(value.restaurant_id) ||
    !isNonblank(value.order_number) ||
    !isActiveStatus(value.status) ||
    (value.notes !== null && typeof value.notes !== "string") ||
    !location ||
    !isUuid(location.id) ||
    location.restaurant_id !== value.restaurant_id ||
    !isNonblank(location.name) ||
    !isNonblank(location.type) ||
    !waiter ||
    !isUuid(waiter.id) ||
    !isNonblank(waiter.display_name) ||
    !Array.isArray(value.baskets)
  ) {
    throw new ActiveOrderReadError();
  }

  const totalAmount = money(value.total_amount);
  if (totalAmount === null) throw new ActiveOrderReadError();
  const restaurantId = value.restaurant_id;
  const createdAt = timestamp(value.created_at);
  const updatedAt = timestamp(value.updated_at);
  const basketIds = new Set<string>();
  const baskets = value.baskets.map((basket) => {
    const mapped = detailed
      ? mapDetailedBasket(basket, restaurantId)
      : mapBasketSummary(basket, restaurantId);
    if (basketIds.has(mapped.id)) throw new ActiveOrderReadError();
    basketIds.add(mapped.id);
    return mapped;
  });
  baskets.sort(compareCreatedAt);

  const basketTotal = sumMoney(baskets.map((basket) => basket.totalAmount));
  if (basketTotal !== totalAmount) throw new ActiveOrderReadError();
  const paidAmount = sumMoney(baskets.map((basket) => basket.paidAmount));

  return {
    base: Object.freeze({
      id: value.id,
      restaurantId,
      orderNumber: value.order_number,
      serviceLocation: Object.freeze({
        id: location.id,
        name: location.name,
        type: location.type,
      }),
      assignedWaiter: Object.freeze({
        id: waiter.id,
        displayName: waiter.display_name,
      }),
      status: value.status,
      notes: value.notes,
      totalAmount,
      paidAmount,
      outstandingBalance: subtractMoney(totalAmount, paidAmount),
      createdAt,
      updatedAt,
    }),
    baskets,
  };
}

function mapBasketSummary(
  value: unknown,
  restaurantId: string,
): ActiveOrderBasketSummary {
  const common = mapBasketBase(value, restaurantId);
  return Object.freeze(common);
}

function mapDetailedBasket(
  value: unknown,
  restaurantId: string,
): ActiveOrderBasket {
  const common = mapBasketBase(value, restaurantId);
  if (!isRecord(value) || !Array.isArray(value.lines)) {
    throw new ActiveOrderReadError();
  }
  const lineIds = new Set<string>();
  const lines = activeLineRows(value.lines, restaurantId).map((line) => {
    const mapped = mapLine(line, restaurantId);
    if (lineIds.has(mapped.id)) throw new ActiveOrderReadError();
    lineIds.add(mapped.id);
    return mapped;
  });
  lines.sort(compareCreatedAt);
  if (lines.length !== common.lineCount) throw new ActiveOrderReadError();
  const currentTotal = sumMoney(
    lines.map((line) => line.currentSnapshot.lineTotal),
  );
  if (currentTotal !== common.totalAmount) throw new ActiveOrderReadError();

  return Object.freeze({ ...common, lines: Object.freeze(lines) });
}

function mapBasketBase(value: unknown, restaurantId: string) {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    value.restaurant_id !== restaurantId ||
    !isBasketStatus(value.status) ||
    !Array.isArray(value.payments) ||
    !Array.isArray(value.lines)
  ) {
    throw new ActiveOrderReadError();
  }
  const totalAmount = money(value.total_amount);
  if (totalAmount === null) throw new ActiveOrderReadError();
  const activeLines = activeLineRows(value.lines, restaurantId);
  const lineIds = new Set<string>();
  for (const line of activeLines) {
    if (
      !isRecord(line) ||
      !isUuid(line.id) ||
      line.restaurant_id !== restaurantId ||
      lineIds.has(line.id)
    ) {
      throw new ActiveOrderReadError();
    }
    lineIds.add(line.id);
  }

  const paymentAmounts = value.payments.map((payment) => {
    if (!isRecord(payment) || payment.restaurant_id !== restaurantId) {
      throw new ActiveOrderReadError();
    }
    const amount = money(payment.amount);
    if (amount === null) throw new ActiveOrderReadError();
    return amount;
  });
  const paidAmount = sumMoney(paymentAmounts);
  return {
    id: value.id,
    status: value.status,
    totalAmount,
    paidAmount,
    outstandingBalance: subtractMoney(totalAmount, paidAmount),
    lineCount: activeLines.length,
    createdAt: timestamp(value.created_at),
    paidAt: nullableTimestamp(value.paid_at),
  } as const;
}

function activeLineRows(values: readonly unknown[], restaurantId: string) {
  const active: Record<string, unknown>[] = [];
  for (const value of values) {
    if (
      !isRecord(value) ||
      !isUuid(value.id) ||
      value.restaurant_id !== restaurantId
    ) {
      throw new ActiveOrderReadError();
    }
    const removal = singleOptionalRelation(value.removal);
    if (removal !== null) {
      if (
        removal.restaurant_id !== restaurantId ||
        removal.order_line_id !== value.id
      ) {
        throw new ActiveOrderReadError();
      }
      continue;
    }
    active.push(value);
  }
  return active;
}

function singleOptionalRelation(
  value: unknown,
): Record<string, unknown> | null {
  if (
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0)
  )
    return null;
  if (isRecord(value)) return value;
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0]))
    return value[0];
  throw new ActiveOrderReadError();
}

function mapLine(value: unknown, restaurantId: string): ActiveOrderLine {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    value.restaurant_id !== restaurantId ||
    !isUuid(value.current_snapshot_id) ||
    !Array.isArray(value.snapshots)
  ) {
    throw new ActiveOrderReadError();
  }
  const snapshotIds = new Set<string>();
  const revisions = new Set<number>();
  const orderLineId = value.id;
  const snapshots = value.snapshots.map((snapshot) => {
    const mapped = mapSnapshot(snapshot, restaurantId, orderLineId);
    if (snapshotIds.has(mapped.id) || revisions.has(mapped.revisionNumber)) {
      throw new ActiveOrderReadError();
    }
    snapshotIds.add(mapped.id);
    revisions.add(mapped.revisionNumber);
    return mapped;
  });
  snapshots.sort((left, right) => left.revisionNumber - right.revisionNumber);
  const currentSnapshot = snapshots.find(
    (snapshot) => snapshot.id === value.current_snapshot_id,
  );
  if (!currentSnapshot) throw new ActiveOrderReadError();

  return Object.freeze({
    id: value.id,
    currentSnapshotId: value.current_snapshot_id,
    createdAt: timestamp(value.created_at),
    currentSnapshot,
    snapshots: Object.freeze(snapshots),
  });
}

function mapSnapshot(
  value: unknown,
  restaurantId: string,
  orderLineId: string,
): ActiveOrderLineSnapshot {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    value.restaurant_id !== restaurantId ||
    value.order_line_id !== orderLineId ||
    !Number.isInteger(value.revision_number) ||
    (value.revision_number as number) < 1 ||
    !isUuid(value.product_version_id) ||
    !isNonblank(value.product_name) ||
    !Number.isInteger(value.quantity) ||
    (value.quantity as number) < 1 ||
    !isNonblank(value.tax_code) ||
    !isNonblank(value.tax_name) ||
    typeof value.price_includes_tax !== "boolean" ||
    !Array.isArray(value.selected_options) ||
    !Array.isArray(value.removed_ingredients) ||
    (value.observations !== null && typeof value.observations !== "string")
  ) {
    throw new ActiveOrderReadError();
  }
  const baseUnitPrice = money(value.base_unit_price);
  const finalUnitPrice = money(value.final_unit_price);
  const lineTotal = money(value.line_total);
  const taxRate = rate(value.tax_rate);
  if (
    baseUnitPrice === null ||
    finalUnitPrice === null ||
    lineTotal === null ||
    taxRate === null ||
    multiplyMoney(finalUnitPrice, value.quantity as number) !== lineTotal
  ) {
    throw new ActiveOrderReadError();
  }

  return Object.freeze({
    id: value.id,
    revisionNumber: value.revision_number as number,
    productVersionId: value.product_version_id,
    productName: value.product_name,
    quantity: value.quantity as number,
    baseUnitPrice,
    finalUnitPrice,
    lineTotal,
    taxCode: value.tax_code,
    taxName: value.tax_name,
    taxRate,
    priceIncludesTax: value.price_includes_tax,
    selectedOptions: mapModifications(value.selected_options),
    removedIngredients: mapModifications(value.removed_ingredients),
    observations: value.observations,
    createdAt: timestamp(value.created_at),
  });
}

function mapModifications(
  values: readonly unknown[],
): readonly ActiveOrderModificationSnapshot[] {
  const ids = new Set<string>();
  return Object.freeze(
    values.map((value) => {
      if (
        !isRecord(value) ||
        !isUuid(value.id) ||
        ids.has(value.id) ||
        !isNonblank(value.name)
      ) {
        throw new ActiveOrderReadError();
      }
      const priceAdjustment =
        value.priceAdjustment === null
          ? null
          : signedMoney(value.priceAdjustment);
      if (value.priceAdjustment !== null && priceAdjustment === null) {
        throw new ActiveOrderReadError();
      }
      ids.add(value.id);
      return Object.freeze({
        id: value.id,
        name: value.name,
        priceAdjustment,
      });
    }),
  );
}

function assertActiveStatuses(statuses: readonly ActiveOrderStatus[]) {
  if (
    statuses.length !== ACTIVE_ORDER_STATUSES.length ||
    ACTIVE_ORDER_STATUSES.some((status) => !statuses.includes(status))
  ) {
    throw new ActiveOrderReadError();
  }
}

function isActiveStatus(value: unknown): value is ActiveOrderStatus {
  return (
    typeof value === "string" &&
    (ACTIVE_ORDER_STATUSES as readonly string[]).includes(value)
  );
}

function isBasketStatus(value: unknown): value is ActiveOrderBasketStatus {
  return value === "PENDING" || value === "PAID";
}

function money(value: unknown) {
  const parts = decimalParts(value, 2);
  if (
    parts === null ||
    parts.negative ||
    parts.scaled > BigInt("999999999999")
  ) {
    return null;
  }
  return formatScaled(parts.scaled, 2);
}

function signedMoney(value: unknown) {
  const parts = decimalParts(value, 2);
  if (parts === null || parts.scaled > BigInt("999999999999")) return null;
  const formatted = formatScaled(parts.scaled, 2);
  return parts.negative && parts.scaled !== BigInt(0)
    ? `-${formatted}`
    : formatted;
}

function rate(value: unknown) {
  const parts = decimalParts(value, 6);
  if (parts === null || parts.negative || parts.scaled > BigInt(1_000_000)) {
    return null;
  }
  return formatScaled(parts.scaled, 6);
}

function decimalParts(value: unknown, scale: number) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^-?\d+(?:\.\d+)?$/.test(String(value))
  ) {
    return null;
  }
  const source = String(value);
  const negative = source.startsWith("-");
  const unsigned = negative ? source.slice(1) : source;
  const [integer, fraction = ""] = unsigned.split(".");
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) {
    return null;
  }
  const scaled =
    BigInt(integer) * BigInt(10) ** BigInt(scale) +
    BigInt((fraction.slice(0, scale) + "0".repeat(scale)).slice(0, scale));
  return { negative, scaled };
}

function formatScaled(value: bigint, scale: number) {
  const source = value.toString().padStart(scale + 1, "0");
  return `${source.slice(0, -scale)}.${source.slice(-scale)}`;
}

function sumMoney(values: readonly string[]) {
  const total = values.reduce((sum, value) => {
    const parts = decimalParts(value, 2);
    if (parts === null || parts.negative) throw new ActiveOrderReadError();
    return sum + parts.scaled;
  }, BigInt(0));
  if (total > BigInt("999999999999")) throw new ActiveOrderReadError();
  return formatScaled(total, 2);
}

function subtractMoney(total: string, paid: string) {
  const totalParts = decimalParts(total, 2);
  const paidParts = decimalParts(paid, 2);
  if (!totalParts || !paidParts) throw new ActiveOrderReadError();
  return formatScaled(
    totalParts.scaled > paidParts.scaled
      ? totalParts.scaled - paidParts.scaled
      : BigInt(0),
    2,
  );
}

function multiplyMoney(value: string, quantity: number) {
  const parts = decimalParts(value, 2);
  if (!parts) throw new ActiveOrderReadError();
  return formatScaled(parts.scaled * BigInt(quantity), 2);
}

function timestamp(value: unknown) {
  if (typeof value !== "string") throw new ActiveOrderReadError();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new ActiveOrderReadError();
  return new Date(milliseconds).toISOString();
}

function nullableTimestamp(value: unknown) {
  return value === null ? null : timestamp(value);
}

function compareCreatedAt(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string },
) {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function singleRelation(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) {
    return value[0];
  }
  return null;
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
