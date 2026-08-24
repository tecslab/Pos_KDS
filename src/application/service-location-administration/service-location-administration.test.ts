import { describe, expect, it, vi } from "vitest";

import { AuditEventService, type AuditEventRecord } from "../audit";
import {
  ServiceLocationAdministrationService,
  type ServiceLocation,
  type ServiceLocationAdministrationGateway,
} from "./service-location-administration";

const actorId = "10000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const current: ServiceLocation = Object.freeze({
  id: locationId,
  restaurantId,
  restaurantName: "Carnales",
  name: "Mesa 1",
  type: "TABLE",
  displayOrder: 1,
  isActive: true,
  allowsMultipleActiveOrders: false,
});

function setup(existing: readonly ServiceLocation[] = [current]) {
  const gateway: ServiceLocationAdministrationGateway = {
    list: vi.fn().mockResolvedValue(existing),
    save: vi.fn().mockImplementation(async (_actor, location) => location),
  };
  const events: AuditEventRecord[] = [];
  const audit = new AuditEventService(
    { append: async (event) => void events.push(event) },
    { now: () => new Date("2026-08-24T02:00:00.000Z") },
  );
  return {
    gateway,
    events,
    service: new ServiceLocationAdministrationService(
      gateway,
      audit,
      () => locationId,
    ),
  };
}

describe("ServiceLocationAdministrationService", () => {
  it("creates a future location type and audits the complete rule", async () => {
    const { service, gateway, events } = setup([]);
    const result = await service.save(actorId, {
      restaurantId,
      name: " Patio Norte ",
      type: "future patio",
      displayOrder: "20",
      isActive: true,
      allowsMultipleActiveOrders: true,
    });
    expect(result.ok).toBe(true);
    expect(gateway.save).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({
        id: locationId,
        name: "Patio Norte",
        type: "FUTURE_PATIO",
        displayOrder: 20,
        allowsMultipleActiveOrders: true,
      }),
    );
    expect(events[0]).toMatchObject({
      action: "service_location.created",
      previousValues: null,
      newValues: { type: "FUTURE_PATIO" },
    });
  });

  it("audits edit, ordering, activation, and multiple-order changes", async () => {
    const { service, events } = setup();
    const result = await service.save(actorId, {
      id: locationId,
      restaurantId,
      name: "Mesa principal",
      type: "TABLE",
      displayOrder: "4",
      isActive: false,
      allowsMultipleActiveOrders: true,
    });
    expect(result.ok).toBe(true);
    expect(events[0]).toMatchObject({
      action: "service_location.deactivated",
      previousValues: {
        displayOrder: 1,
        isActive: true,
        allowsMultipleActiveOrders: false,
      },
      newValues: {
        displayOrder: 4,
        isActive: false,
        allowsMultipleActiveOrders: true,
      },
    });
  });

  it.each([{ name: " " }, { type: " " }, { displayOrder: "-1" }])(
    "rejects invalid input before audit/persistence",
    async (override) => {
      const { service, gateway, events } = setup();
      const result = await service.save(actorId, {
        id: locationId,
        restaurantId,
        name: "Mesa",
        type: "TABLE",
        displayOrder: "1",
        isActive: true,
        allowsMultipleActiveOrders: false,
        ...override,
      });
      expect(result.ok).toBe(false);
      expect(gateway.save).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    },
  );
});
