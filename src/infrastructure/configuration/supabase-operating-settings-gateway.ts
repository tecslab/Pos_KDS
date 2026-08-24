import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuditEventAppender,
  AuditEventRecord,
  OperatingSettings,
  OperatingSettingsGateway,
} from "../../application";

export class SupabaseOperatingSettingsGateway
  implements OperatingSettingsGateway, AuditEventAppender
{
  private pendingAudit: AuditEventRecord | null = null;

  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<readonly OperatingSettings[]> {
    try {
      const [restaurants, configurations, taxes] = await Promise.all([
        this.client
          .from("restaurants")
          .select("id, name")
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("restaurant_configurations")
          .select(
            "restaurant_id, preparation_warning_threshold_minutes, preparation_critical_threshold_minutes, delivery_warning_threshold_minutes, delivery_critical_threshold_minutes, inventory_policy, printing_behavior, business_hours",
          ),
        this.client
          .from("restaurant_tax_rates")
          .select("id, restaurant_id, name, rate")
          .eq("is_active", true)
          .is("deleted_at", null),
      ]);
      if (restaurants.error || configurations.error || taxes.error)
        throw new Error();
      if (
        !Array.isArray(restaurants.data) ||
        !Array.isArray(configurations.data) ||
        !Array.isArray(taxes.data)
      )
        throw new Error();
      return Object.freeze(
        restaurants.data.map((restaurant) =>
          mapSettings(restaurant, configurations.data, taxes.data),
        ),
      );
    } catch {
      throw new Error("Operating settings persistence failed.");
    }
  }

  async update(
    actorId: string,
    settings: OperatingSettings,
  ): Promise<OperatingSettings> {
    try {
      const audit = this.pendingAudit;
      if (
        audit === null ||
        audit.actorId !== actorId ||
        audit.entityId !== settings.restaurantId
      )
        throw new Error();
      const { data, error } = await this.client.rpc(
        "update_restaurant_operating_settings",
        {
          actor_user_id: actorId,
          target_restaurant_id: settings.restaurantId,
          target_tax_rate_id: settings.taxRateId,
          restaurant_name: settings.restaurantName,
          tax_name: settings.taxName,
          tax_rate: settings.taxRatePercent / 100,
          opens_at: settings.opensAt,
          closes_at: settings.closesAt,
          preparation_warning_minutes: settings.preparationWarningMinutes,
          preparation_critical_minutes: settings.preparationCriticalMinutes,
          delivery_warning_minutes: settings.deliveryWarningMinutes,
          delivery_critical_minutes: settings.deliveryCriticalMinutes,
          allow_negative_stock: settings.allowNegativeStock,
          printing_mode: JSON.stringify(audit),
        },
      );
      if (error || !Array.isArray(data) || data.length !== 1) throw new Error();
      return Object.freeze(settings);
    } catch {
      throw new Error("Operating settings persistence failed.");
    } finally {
      this.pendingAudit = null;
    }
  }

  async append(event: AuditEventRecord): Promise<void> {
    if (this.pendingAudit !== null)
      throw new Error("Audit transaction is busy.");
    this.pendingAudit = event;
  }
}

function mapSettings(
  restaurant: unknown,
  configurations: unknown[],
  taxes: unknown[],
): OperatingSettings {
  if (
    !isRecord(restaurant) ||
    typeof restaurant.id !== "string" ||
    typeof restaurant.name !== "string"
  )
    throw new Error();
  const configuration = configurations.find(
    (row) => isRecord(row) && row.restaurant_id === restaurant.id,
  );
  const matchingTaxes = taxes.filter(
    (row) => isRecord(row) && row.restaurant_id === restaurant.id,
  );
  if (
    !isRecord(configuration) ||
    matchingTaxes.length !== 1 ||
    !isRecord(matchingTaxes[0])
  )
    throw new Error();
  const tax = matchingTaxes[0];
  const hours = configuration.business_hours;
  const inventory = configuration.inventory_policy;
  if (
    !isRecord(hours) ||
    !isRecord(hours.daily) ||
    typeof hours.daily.opensAt !== "string" ||
    typeof hours.daily.closesAt !== "string" ||
    !isRecord(inventory) ||
    typeof inventory.allowNegativeStock !== "boolean"
  )
    throw new Error();
  const integers = [
    configuration.preparation_warning_threshold_minutes,
    configuration.preparation_critical_threshold_minutes,
    configuration.delivery_warning_threshold_minutes,
    configuration.delivery_critical_threshold_minutes,
  ];
  if (
    typeof tax.id !== "string" ||
    typeof tax.name !== "string" ||
    !integers.every(Number.isInteger)
  )
    throw new Error();
  const numericRate =
    typeof tax.rate === "number"
      ? tax.rate
      : typeof tax.rate === "string"
        ? Number(tax.rate)
        : NaN;
  if (!Number.isFinite(numericRate)) throw new Error();
  return Object.freeze({
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    taxRateId: tax.id,
    taxName: tax.name,
    taxRatePercent: numericRate * 100,
    opensAt: hours.daily.opensAt,
    closesAt: hours.daily.closesAt,
    preparationWarningMinutes: integers[0] as number,
    preparationCriticalMinutes: integers[1] as number,
    deliveryWarningMinutes: integers[2] as number,
    deliveryCriticalMinutes: integers[3] as number,
    allowNegativeStock: inventory.allowNegativeStock,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
