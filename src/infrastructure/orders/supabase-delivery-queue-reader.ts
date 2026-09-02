import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DeliveryQueueFilters,
  DeliveryQueueLine,
  DeliveryQueueOrder,
  DeliveryQueueReader,
} from "../../application";

const DELIVERY_QUEUE_FIELDS = `
  id,
  restaurant_id,
  order_number,
  status,
  notes,
  created_at,
  ready_at,
  service_location:service_locations!orders_service_location_fkey (
    id,
    restaurant_id,
    name,
    type
  ),
  baskets:customer_baskets (
    id,
    restaurant_id,
    lines:order_lines (
      id,
      restaurant_id,
      current_snapshot_id,
      removal:order_line_removals!order_line_removals_line_fkey (
        restaurant_id,
        order_line_id
      ),
      snapshots:order_line_sale_snapshots!order_line_snapshots_line_fkey (
        id,
        restaurant_id,
        order_line_id,
        quantity,
        observations
      )
    )
  )
`;

export class DeliveryQueueReadError extends Error {
  constructor() {
    super("The delivery queue could not be read.");
    this.name = "DeliveryQueueReadError";
  }
}

export class SupabaseDeliveryQueueReader implements DeliveryQueueReader {
  constructor(private readonly client: SupabaseClient) {}

  async readReady(
    filters: DeliveryQueueFilters,
  ): Promise<readonly DeliveryQueueOrder[]> {
    try {
      let query = this.client
        .from("orders")
        .select(DELIVERY_QUEUE_FIELDS)
        .eq("status", "READY");
      if (filters.serviceLocationId)
        query = query.eq("service_location_id", filters.serviceLocationId);
      if (filters.orderNumber)
        query = query.eq("order_number", filters.orderNumber);
      if (filters.readyAtBeforeOrEqual)
        query = query.lte("ready_at", filters.readyAtBeforeOrEqual);

      const { data, error } = await query
        .order("ready_at", { ascending: true })
        .order("id", { ascending: true });
      if (error !== null || !Array.isArray(data)) throw new Error();
      return Object.freeze(data.map(mapDeliveryQueueRow));
    } catch {
      throw new DeliveryQueueReadError();
    }
  }
}

export function mapDeliveryQueueRow(value: unknown): DeliveryQueueOrder {
  if (!isRecord(value)) throw new DeliveryQueueReadError();
  const location = singleRelation(value.service_location);
  if (
    !isUuid(value.id) ||
    !isUuid(value.restaurant_id) ||
    !isNonblank(value.order_number) ||
    value.status !== "READY" ||
    (value.notes !== null && typeof value.notes !== "string") ||
    !location ||
    !isUuid(location.id) ||
    location.restaurant_id !== value.restaurant_id ||
    !isNonblank(location.name) ||
    !isNonblank(location.type) ||
    !Array.isArray(value.baskets)
  ) {
    throw new DeliveryQueueReadError();
  }

  const restaurantId = value.restaurant_id;
  const basketIds = new Set<string>();
  const lineIds = new Set<string>();
  const lines: DeliveryQueueLine[] = [];
  for (const basket of value.baskets) {
    if (
      !isRecord(basket) ||
      !isUuid(basket.id) ||
      basketIds.has(basket.id) ||
      basket.restaurant_id !== restaurantId ||
      !Array.isArray(basket.lines)
    ) {
      throw new DeliveryQueueReadError();
    }
    basketIds.add(basket.id);

    for (const rawLine of basket.lines) {
      const line = mapLine(rawLine, restaurantId);
      if (line === null) continue;
      if (lineIds.has(line.id)) throw new DeliveryQueueReadError();
      lineIds.add(line.id);
      lines.push(line);
    }
  }
  if (lines.length === 0) throw new DeliveryQueueReadError();

  return Object.freeze({
    id: value.id,
    restaurantId,
    orderNumber: value.order_number,
    status: "READY",
    serviceLocation: Object.freeze({
      id: location.id,
      name: location.name,
      type: location.type,
    }),
    notes: value.notes,
    createdAt: timestamp(value.created_at),
    readyAt: timestamp(value.ready_at),
    lines: Object.freeze(lines),
  });
}

function mapLine(
  value: unknown,
  restaurantId: string,
): DeliveryQueueLine | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    value.restaurant_id !== restaurantId ||
    !isUuid(value.current_snapshot_id) ||
    !Array.isArray(value.snapshots)
  ) {
    throw new DeliveryQueueReadError();
  }

  const removal = singleOptionalRelation(value.removal);
  if (removal !== null) {
    if (
      removal.restaurant_id !== restaurantId ||
      removal.order_line_id !== value.id
    ) {
      throw new DeliveryQueueReadError();
    }
    return null;
  }

  const current = value.snapshots.filter(
    (snapshot): snapshot is Record<string, unknown> =>
      isRecord(snapshot) && snapshot.id === value.current_snapshot_id,
  );
  if (current.length !== 1) throw new DeliveryQueueReadError();
  const snapshot = current[0]!;
  if (
    !isUuid(snapshot.id) ||
    snapshot.restaurant_id !== restaurantId ||
    snapshot.order_line_id !== value.id ||
    !Number.isSafeInteger(snapshot.quantity) ||
    (snapshot.quantity as number) < 1 ||
    (snapshot.observations !== null &&
      typeof snapshot.observations !== "string")
  ) {
    throw new DeliveryQueueReadError();
  }

  return Object.freeze({
    id: value.id,
    quantity: snapshot.quantity as number,
    observations: snapshot.observations,
  });
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new DeliveryQueueReadError();
  }
  return new Date(Date.parse(value)).toISOString();
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
  if (
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return null;
  }
  if (isRecord(value)) return value;
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) {
    return value[0];
  }
  throw new DeliveryQueueReadError();
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
