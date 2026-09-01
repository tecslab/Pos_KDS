import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  KitchenQueueLine,
  KitchenQueueModification,
  KitchenQueueOrder,
  KitchenQueueReader,
} from "../../application";

const KITCHEN_QUEUE_FIELDS = `
  id,
  restaurant_id,
  order_number,
  status,
  created_at,
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
        selected_options,
        removed_ingredients,
        observations
      )
    )
  )
`;

export class KitchenQueueReadError extends Error {
  constructor() {
    super("The kitchen queue could not be read.");
    this.name = "KitchenQueueReadError";
  }
}

export class SupabaseKitchenQueueReader implements KitchenQueueReader {
  constructor(private readonly client: SupabaseClient) {}

  async readPending(): Promise<readonly KitchenQueueOrder[]> {
    try {
      const { data, error } = await this.client
        .from("orders")
        .select(KITCHEN_QUEUE_FIELDS)
        .eq("status", "PENDING")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      if (error !== null || !Array.isArray(data)) throw new Error();
      return Object.freeze(data.map(mapKitchenQueueRow));
    } catch {
      throw new KitchenQueueReadError();
    }
  }
}

export function mapKitchenQueueRow(value: unknown): KitchenQueueOrder {
  if (!isRecord(value)) throw new KitchenQueueReadError();
  const location = singleRelation(value.service_location);
  if (
    !isUuid(value.id) ||
    !isUuid(value.restaurant_id) ||
    !isNonblank(value.order_number) ||
    value.status !== "PENDING" ||
    !location ||
    !isUuid(location.id) ||
    location.restaurant_id !== value.restaurant_id ||
    !isNonblank(location.name) ||
    !isNonblank(location.type) ||
    !Array.isArray(value.baskets)
  ) {
    throw new KitchenQueueReadError();
  }

  const restaurantId = value.restaurant_id;
  const basketIds = new Set<string>();
  const lineIds = new Set<string>();
  const lines: (KitchenQueueLine & Readonly<{ createdAt: string }>)[] = [];

  for (const basket of value.baskets) {
    if (
      !isRecord(basket) ||
      !isUuid(basket.id) ||
      basketIds.has(basket.id) ||
      basket.restaurant_id !== restaurantId ||
      !Array.isArray(basket.lines)
    ) {
      throw new KitchenQueueReadError();
    }
    basketIds.add(basket.id);

    for (const rawLine of basket.lines) {
      const line = mapLine(rawLine, restaurantId);
      if (line === null) continue;
      if (lineIds.has(line.id)) throw new KitchenQueueReadError();
      lineIds.add(line.id);
      lines.push(line);
    }
  }

  if (lines.length === 0) throw new KitchenQueueReadError();
  lines.sort(compareCreatedAt);

  return Object.freeze({
    id: value.id,
    restaurantId,
    orderNumber: value.order_number,
    status: "PENDING",
    serviceLocation: Object.freeze({
      id: location.id,
      name: location.name,
      type: location.type,
    }),
    createdAt: timestamp(value.created_at),
    lines: Object.freeze(
      lines.map((line) =>
        Object.freeze({
          id: line.id,
          productName: line.productName,
          quantity: line.quantity,
          selectedOptions: line.selectedOptions,
          removedIngredients: line.removedIngredients,
          observations: line.observations,
        }),
      ),
    ),
  });
}

function mapLine(
  value: unknown,
  restaurantId: string,
): (KitchenQueueLine & Readonly<{ createdAt: string }>) | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    value.restaurant_id !== restaurantId ||
    !isUuid(value.current_snapshot_id) ||
    !Array.isArray(value.snapshots)
  ) {
    throw new KitchenQueueReadError();
  }

  const removal = singleOptionalRelation(value.removal);
  if (removal !== null) {
    if (
      removal.restaurant_id !== restaurantId ||
      removal.order_line_id !== value.id
    ) {
      throw new KitchenQueueReadError();
    }
    return null;
  }

  const snapshots = value.snapshots.map((snapshot) => {
    if (
      !isRecord(snapshot) ||
      !isUuid(snapshot.id) ||
      snapshot.restaurant_id !== restaurantId ||
      snapshot.order_line_id !== value.id
    ) {
      throw new KitchenQueueReadError();
    }
    return snapshot;
  });
  const current = snapshots.filter(
    (snapshot) => snapshot.id === value.current_snapshot_id,
  );
  if (current.length !== 1) throw new KitchenQueueReadError();
  const snapshot = current[0]!;
  if (
    !isNonblank(snapshot.product_name) ||
    !Number.isInteger(snapshot.quantity) ||
    (snapshot.quantity as number) < 1 ||
    !Array.isArray(snapshot.selected_options) ||
    !Array.isArray(snapshot.removed_ingredients) ||
    (snapshot.observations !== null &&
      typeof snapshot.observations !== "string")
  ) {
    throw new KitchenQueueReadError();
  }

  return Object.freeze({
    id: value.id,
    productName: snapshot.product_name,
    quantity: snapshot.quantity as number,
    selectedOptions: mapModifications(snapshot.selected_options),
    removedIngredients: mapModifications(snapshot.removed_ingredients),
    observations: snapshot.observations,
    createdAt: timestamp(value.created_at),
  });
}

function mapModifications(
  values: readonly unknown[],
): readonly KitchenQueueModification[] {
  const ids = new Set<string>();
  return Object.freeze(
    values.map((value) => {
      if (
        !isRecord(value) ||
        !isUuid(value.id) ||
        ids.has(value.id) ||
        !isNonblank(value.name)
      ) {
        throw new KitchenQueueReadError();
      }
      ids.add(value.id);
      return Object.freeze({ id: value.id, name: value.name });
    }),
  );
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

function timestamp(value: unknown) {
  if (typeof value !== "string") throw new KitchenQueueReadError();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new KitchenQueueReadError();
  return new Date(milliseconds).toISOString();
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
  throw new KitchenQueueReadError();
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
