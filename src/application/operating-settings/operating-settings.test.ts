import { describe, expect, it, vi } from "vitest";
import { AuditEventService, type AuditEventRecord } from "../audit";

import {
  OperatingSettingsService,
  type OperatingSettingsGateway,
} from "./operating-settings";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const taxRateId = "33000000-0000-4000-8000-000000000001";

function setup() {
  const current = {
    restaurantId,
    taxRateId,
    restaurantName: "Carnales — Mexican Grill",
    taxName: "IVA 15%",
    taxRatePercent: 15,
    opensAt: "11:00",
    closesAt: "22:00",
    preparationWarningMinutes: 5,
    preparationCriticalMinutes: 7,
    deliveryWarningMinutes: 6,
    deliveryCriticalMinutes: 8,
    allowNegativeStock: false,
  } as const;
  const gateway: OperatingSettingsGateway = {
    list: vi.fn().mockResolvedValue([current]),
    update: vi.fn().mockImplementation(async (_actor, settings) => settings),
  };
  const events: AuditEventRecord[] = [];
  const audit = new AuditEventService(
    { append: async (event) => void events.push(event) },
    { now: () => new Date("2026-08-23T05:00:00.000Z") },
  );
  return {
    events,
    gateway,
    service: new OperatingSettingsService(gateway, audit),
  };
}

const input = {
  restaurantId,
  taxRateId,
  restaurantName: " Carnales — Mexican   Grill ",
  taxName: "IVA 15%",
  taxRatePercent: "15",
  opensAt: "11:00",
  closesAt: "22:00",
  preparationWarningMinutes: "5",
  preparationCriticalMinutes: "7",
  deliveryWarningMinutes: "6",
  deliveryCriticalMinutes: "8",
  allowNegativeStock: false,
};

describe("OperatingSettingsService", () => {
  it("normalizes approved settings through the centralized audit service", async () => {
    const { service, gateway, events } = setup();
    const result = await service.update(actorId, input);
    expect(result.ok).toBe(true);
    expect(gateway.update).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({
        restaurantName: "Carnales — Mexican Grill",
        taxRatePercent: 15,
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "restaurant.operating_settings_updated",
      previousValues: { allowNegativeStock: false },
      newValues: { allowNegativeStock: false },
    });
  });

  it.each([
    ["empty name", { restaurantName: " " }],
    ["invalid tax", { taxRatePercent: "101" }],
    ["reversed hours", { opensAt: "22:00", closesAt: "11:00" }],
    [
      "kitchen threshold order",
      { preparationWarningMinutes: "8", preparationCriticalMinutes: "7" },
    ],
    [
      "delivery threshold order",
      { deliveryWarningMinutes: "9", deliveryCriticalMinutes: "8" },
    ],
  ])("rejects %s before persistence", async (_label, override) => {
    const { service, gateway } = setup();
    const result = await service.update(actorId, { ...input, ...override });
    expect(result.ok).toBe(false);
    expect(gateway.update).not.toHaveBeenCalled();
  });

  it("sanitizes infrastructure failures", async () => {
    const { service, gateway } = setup();
    vi.mocked(gateway.update).mockRejectedValueOnce(
      new Error("database secret"),
    );
    await expect(service.update(actorId, input)).resolves.toEqual({
      ok: false,
      error: { kind: "operating-settings-error", code: "OPERATION_FAILED" },
    });
  });
});
