import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuditEventAppender,
  AuditEventRecord,
  ServiceLocation,
  ServiceLocationAdministrationGateway,
} from "../../application";

export class SupabaseServiceLocationAdministrationGateway
  implements ServiceLocationAdministrationGateway, AuditEventAppender
{
  private pendingAudit: AuditEventRecord | null = null;
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<readonly ServiceLocation[]> {
    try {
      const [restaurants, locations] = await Promise.all([
        this.client
          .from("restaurants")
          .select("id, name")
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("service_locations")
          .select(
            "id, restaurant_id, name, type, display_order, is_active, allows_multiple_active_orders",
          )
          .is("deleted_at", null),
      ]);
      if (
        restaurants.error ||
        locations.error ||
        !Array.isArray(restaurants.data) ||
        !Array.isArray(locations.data)
      )
        throw new Error();
      const names = new Map(restaurants.data.map((row) => [row.id, row.name]));
      return Object.freeze(
        locations.data
          .map((row) => mapLocation(row, names))
          .sort(
            (a, b) =>
              a.displayOrder - b.displayOrder ||
              a.name.localeCompare(b.name, "es"),
          ),
      );
    } catch {
      throw new Error("Service location persistence failed.");
    }
  }

  async save(
    actorId: string,
    location: ServiceLocation,
  ): Promise<ServiceLocation> {
    try {
      const audit = this.pendingAudit;
      if (!audit || audit.actorId !== actorId || audit.entityId !== location.id)
        throw new Error();
      const { data, error } = await this.client.rpc("save_service_location", {
        actor_user_id: actorId,
        target_restaurant_id: location.restaurantId,
        target_location_id: location.id,
        location_name: location.name,
        location_type: location.type,
        location_display_order: location.displayOrder,
        location_is_active: location.isActive,
        location_allows_multiple: location.allowsMultipleActiveOrders,
        audit_event_text: JSON.stringify(audit),
      });
      if (error || !Array.isArray(data) || data.length !== 1) throw new Error();
      return Object.freeze(location);
    } catch {
      throw new Error("Service location persistence failed.");
    } finally {
      this.pendingAudit = null;
    }
  }

  async append(event: AuditEventRecord) {
    if (this.pendingAudit) throw new Error("Audit transaction is busy.");
    this.pendingAudit = event;
  }
}

function mapLocation(
  row: unknown,
  names: Map<unknown, unknown>,
): ServiceLocation {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.type !== "string" ||
    !Number.isInteger(row.display_order) ||
    typeof row.is_active !== "boolean" ||
    typeof row.allows_multiple_active_orders !== "boolean" ||
    typeof names.get(row.restaurant_id) !== "string"
  )
    throw new Error();
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    restaurantName: names.get(row.restaurant_id) as string,
    name: row.name,
    type: row.type,
    displayOrder: row.display_order as number,
    isActive: row.is_active,
    allowsMultipleActiveOrders: row.allows_multiple_active_orders,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
