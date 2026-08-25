import { describe, expect, it, vi } from "vitest";

import { AuditEventService, type AuditEventRecord } from "../audit";
import {
  InventoryItemAdministrationService,
  type InventoryItem,
  type InventoryItemAdministrationGateway,
  type InventoryItemAdministrationView,
} from "./inventory-item-administration";

const actorId = "10000000-0000-4000-8000-000000000001";
const itemId = "52000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const current: InventoryItem = Object.freeze({
  id: itemId,
  restaurantId,
  restaurantName: "Carnales",
  name: "Cebolla",
  type: "RAW_INGREDIENT",
  unitOfMeasure: "kg",
  minimumStockLevel: 2.5,
  currentStock: 8,
  isActive: true,
  identityLocked: true,
});

function setup(items: readonly InventoryItem[] = [current]) {
  const view: InventoryItemAdministrationView = {
    restaurants: [{ id: restaurantId, name: "Carnales" }],
    items,
  };
  const gateway: InventoryItemAdministrationGateway = {
    list: vi.fn().mockResolvedValue(view),
    save: vi.fn().mockImplementation(async (_actor, item) => item),
  };
  const events: AuditEventRecord[] = [];
  const audit = new AuditEventService(
    { append: async (event) => void events.push(event) },
    { now: () => new Date("2026-08-24T15:00:00.000Z") },
  );
  return {
    gateway,
    events,
    service: new InventoryItemAdministrationService(
      gateway,
      audit,
      () => itemId,
    ),
  };
}

describe("InventoryItemAdministrationService", () => {
  it("lists restaurants, movement-derived stock, and all three item types", async () => {
    const items = [
      current,
      {
        ...current,
        id: "52000000-0000-4000-8000-000000000002",
        type: "PRODUCED_ITEM" as const,
      },
      {
        ...current,
        id: "52000000-0000-4000-8000-000000000003",
        type: "RESALE_ITEM" as const,
      },
    ];
    const result = await setup(items).service.list();
    expect(result).toMatchObject({
      ok: true,
      value: { items: [{ currentStock: 8 }, {}, {}] },
    });
  });

  it("creates a normalized item with a complete administrative audit", async () => {
    const { service, gateway, events } = setup([]);
    const result = await service.save(actorId, {
      restaurantId,
      name: "  Salsa   verde ",
      type: "PRODUCED_ITEM",
      unitOfMeasure: "  litro ",
      minimumStockLevel: "2.500",
      isActive: true,
    });
    expect(result.ok).toBe(true);
    expect(gateway.save).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({
        name: "Salsa verde",
        type: "PRODUCED_ITEM",
        unitOfMeasure: "litro",
        minimumStockLevel: 2.5,
        currentStock: 0,
      }),
    );
    expect(events[0]).toMatchObject({
      action: "inventory_item.created",
      entityType: "inventory_item",
      previousValues: null,
      newValues: {
        restaurantId,
        name: "Salsa verde",
        type: "PRODUCED_ITEM",
        unitOfMeasure: "litro",
        minimumStockLevel: 2.5,
        isActive: true,
      },
    });
    expect(events[0]?.newValues).not.toHaveProperty("currentStock");
  });

  it.each([
    [false, "inventory_item.deactivated"],
    [true, "inventory_item.activated"],
  ])("audits activation state transitions", async (isActive, action) => {
    const existing = Object.freeze({ ...current, isActive: !isActive });
    const { service, events } = setup([existing]);
    const result = await service.save(actorId, {
      id: itemId,
      restaurantId,
      name: existing.name,
      type: existing.type,
      unitOfMeasure: existing.unitOfMeasure,
      minimumStockLevel: String(existing.minimumStockLevel),
      isActive,
    });
    expect(result.ok).toBe(true);
    expect(events[0]).toMatchObject({ action });
  });

  it("edits descriptive policy without changing stock", async () => {
    const { service, gateway, events } = setup();
    await service.save(actorId, {
      id: itemId,
      restaurantId,
      name: "Cebolla blanca",
      type: current.type,
      unitOfMeasure: current.unitOfMeasure,
      minimumStockLevel: "3",
      isActive: true,
    });
    expect(gateway.save).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({ currentStock: 8, minimumStockLevel: 3 }),
    );
    expect(events[0]).toMatchObject({
      action: "inventory_item.updated",
      previousValues: { name: "Cebolla", minimumStockLevel: 2.5 },
      newValues: { name: "Cebolla blanca", minimumStockLevel: 3 },
    });
  });

  it("rejects type or unit changes after the first movement", async () => {
    for (const override of [{ type: "RESALE_ITEM" }, { unitOfMeasure: "g" }]) {
      const { service, gateway, events } = setup();
      const result = await service.save(actorId, {
        id: itemId,
        restaurantId,
        name: current.name,
        type: current.type,
        unitOfMeasure: current.unitOfMeasure,
        minimumStockLevel: "2.5",
        isActive: true,
        ...override,
      });
      expect(result.ok).toBe(false);
      expect(gateway.save).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    }
  });

  it.each([
    { type: "OTHER" },
    { minimumStockLevel: "-1" },
    { minimumStockLevel: "1.2345" },
    { unitOfMeasure: " " },
    { name: " " },
  ])("rejects invalid input before audit and persistence", async (override) => {
    const { service, gateway, events } = setup([]);
    const result = await service.save(actorId, {
      restaurantId,
      name: "Agua",
      type: "RESALE_ITEM",
      unitOfMeasure: "unidad",
      minimumStockLevel: "1",
      isActive: true,
      ...override,
    });
    expect(result.ok).toBe(false);
    expect(gateway.save).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });
});
