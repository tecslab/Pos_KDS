import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";

import type { OperatingSettings } from "../../application";
import { SupabaseOperatingSettingsGateway } from "./supabase-operating-settings-gateway";

const settings: OperatingSettings = Object.freeze({
  restaurantId: "30000000-0000-4000-8000-000000000001",
  restaurantName: "Carnales — Mexican Grill",
  taxRateId: "33000000-0000-4000-8000-000000000001",
  taxName: "IVA 15%",
  taxRatePercent: 15,
  opensAt: "11:00",
  closesAt: "22:00",
  preparationWarningMinutes: 5,
  preparationCriticalMinutes: 7,
  deliveryWarningMinutes: 6,
  deliveryCriticalMinutes: 8,
  allowNegativeStock: false,
});

it("uses the single audited atomic RPC and converts percentage to rate", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: [{ previous_values: {}, new_values: {} }],
    error: null,
  });
  const gateway = new SupabaseOperatingSettingsGateway({
    rpc,
  } as unknown as SupabaseClient);
  await gateway.append({
    actorId: "10000000-0000-4000-8000-000000000001",
    occurredAt: "2026-08-23T05:00:00.000Z",
    action: "restaurant.operating_settings_updated",
    entityType: "restaurant",
    entityId: settings.restaurantId,
    previousValues: { name: settings.restaurantName },
    newValues: { name: settings.restaurantName },
    sourceIp: null,
  });
  await gateway.update("10000000-0000-4000-8000-000000000001", settings);
  expect(rpc).toHaveBeenCalledWith(
    "update_restaurant_operating_settings",
    expect.objectContaining({
      tax_rate: 0.15,
      tax_name: "IVA 15%",
      allow_negative_stock: false,
      printing_mode: expect.stringContaining(
        '"action":"restaurant.operating_settings_updated"',
      ),
    }),
  );
  expect(JSON.stringify(rpc.mock.calls)).not.toMatch(
    /address|tax_id|logo|thermal|receipt/i,
  );
});

it("requires a centralized staged audit event before mutation", async () => {
  const rpc = vi.fn();
  const gateway = new SupabaseOperatingSettingsGateway({
    rpc,
  } as unknown as SupabaseClient);
  await expect(
    gateway.update("10000000-0000-4000-8000-000000000001", settings),
  ).rejects.toThrow("Operating settings persistence failed");
  expect(rpc).not.toHaveBeenCalled();
});

it("reads settings without rejecting opaque printing or future JSON keys", async () => {
  const responses: Readonly<Record<string, unknown>> = {
    restaurants: {
      data: [{ id: settings.restaurantId, name: settings.restaurantName }],
      error: null,
    },
    restaurant_configurations: {
      data: [
        {
          restaurant_id: settings.restaurantId,
          preparation_warning_threshold_minutes: 5,
          preparation_critical_threshold_minutes: 7,
          delivery_warning_threshold_minutes: 6,
          delivery_critical_threshold_minutes: 8,
          inventory_policy: { allowNegativeStock: false, futurePolicy: "kept" },
          printing_behavior: { futureAutomaticRule: { enabled: true } },
          business_hours: {
            daily: { opensAt: "11:00", closesAt: "22:00", futureWindow: true },
            holidays: { closed: true },
          },
        },
      ],
      error: null,
    },
    restaurant_tax_rates: {
      data: [
        {
          id: settings.taxRateId,
          restaurant_id: settings.restaurantId,
          name: settings.taxName,
          rate: "0.15",
        },
      ],
      error: null,
    },
  };
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => {
      const response = responses[table];
      const builder = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue(response),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(response).then(resolve),
      };
      return builder;
    }),
  }));
  const gateway = new SupabaseOperatingSettingsGateway({
    from,
  } as unknown as SupabaseClient);

  await expect(gateway.list()).resolves.toEqual([settings]);
});
