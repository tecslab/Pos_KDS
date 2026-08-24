import { describe, expect, it, vi } from "vitest";

import { AuditEventService, type AuditEventRecord } from "../audit";
import {
  ProductCategoryAdministrationService,
  type ProductCategory,
  type ProductCategoryAdministrationGateway,
  type ProductCategoryAdministrationView,
} from "./product-category-administration";

const actorId = "10000000-0000-4000-8000-000000000001";
const categoryId = "33000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const current: ProductCategory = Object.freeze({
  id: categoryId,
  restaurantId,
  restaurantName: "Carnales",
  name: "Tacos",
  displayOrder: 1,
  isActive: true,
});

function setup(categories: readonly ProductCategory[] = [current]) {
  const view: ProductCategoryAdministrationView = {
    restaurants: [{ id: restaurantId, name: "Carnales" }],
    categories,
  };
  const gateway: ProductCategoryAdministrationGateway = {
    list: vi.fn().mockResolvedValue(view),
    save: vi.fn().mockImplementation(async (_actor, category) => category),
  };
  const events: AuditEventRecord[] = [];
  const audit = new AuditEventService(
    { append: async (event) => void events.push(event) },
    { now: () => new Date("2026-08-24T12:00:00.000Z") },
  );
  return {
    gateway,
    events,
    service: new ProductCategoryAdministrationService(
      gateway,
      audit,
      () => categoryId,
    ),
  };
}

describe("ProductCategoryAdministrationService", () => {
  it("lists restaurants even before their first category exists", async () => {
    const { service } = setup([]);
    const result = await service.list();
    expect(result).toMatchObject({
      ok: true,
      value: {
        restaurants: [{ id: restaurantId, name: "Carnales" }],
        categories: [],
      },
    });
  });

  it("creates a normalized active category with a complete audit snapshot", async () => {
    const { service, gateway, events } = setup([]);
    const result = await service.save(actorId, {
      restaurantId,
      name: "  Platos   fuertes ",
      displayOrder: "2",
      isActive: true,
    });

    expect(result.ok).toBe(true);
    expect(gateway.save).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({
        id: categoryId,
        name: "Platos fuertes",
        displayOrder: 2,
        isActive: true,
      }),
    );
    expect(events[0]).toMatchObject({
      action: "product_category.created",
      entityType: "product_category",
      previousValues: null,
      newValues: {
        restaurantId,
        name: "Platos fuertes",
        displayOrder: 2,
        isActive: true,
      },
    });
  });

  it.each([
    {
      label: "edits",
      input: { name: "Especialidades", displayOrder: "1", isActive: true },
      action: "product_category.updated",
    },
    {
      label: "reorders",
      input: { name: "Tacos", displayOrder: "4", isActive: true },
      action: "product_category.reordered",
    },
    {
      label: "deactivates",
      input: { name: "Tacos", displayOrder: "1", isActive: false },
      action: "product_category.deactivated",
    },
  ])(
    "$label a category and audits before-and-after values",
    async ({ input, action }) => {
      const { service, events } = setup();
      expect(
        (
          await service.save(actorId, {
            id: categoryId,
            restaurantId,
            ...input,
          })
        ).ok,
      ).toBe(true);
      expect(events[0]).toMatchObject({
        action,
        previousValues: { name: "Tacos", displayOrder: 1, isActive: true },
        newValues: {
          name: input.name,
          displayOrder: Number(input.displayOrder),
          isActive: input.isActive,
        },
      });
    },
  );

  it("reactivates an inactive category with an activation audit", async () => {
    const { service, events } = setup([
      Object.freeze({ ...current, isActive: false }),
    ]);
    const result = await service.save(actorId, {
      id: categoryId,
      restaurantId,
      name: "Tacos",
      displayOrder: "1",
      isActive: true,
    });
    expect(result.ok).toBe(true);
    expect(events[0]).toMatchObject({
      action: "product_category.activated",
      previousValues: { isActive: false },
      newValues: { isActive: true },
    });
  });

  it.each([{ name: " " }, { displayOrder: "-1" }, { displayOrder: "1.5" }])(
    "rejects invalid input before audit and persistence",
    async (override) => {
      const { service, gateway, events } = setup([]);
      const result = await service.save(actorId, {
        restaurantId,
        name: "Bebidas",
        displayOrder: "1",
        isActive: true,
        ...override,
      });
      expect(result.ok).toBe(false);
      expect(gateway.save).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    },
  );

  it("fails closed when the restaurant is outside the authorized data view", async () => {
    const { service, gateway, events } = setup([]);
    vi.mocked(gateway.list).mockResolvedValue({
      restaurants: [],
      categories: [],
    });
    const result = await service.save(actorId, {
      restaurantId,
      name: "Bebidas",
      displayOrder: "1",
      isActive: true,
    });
    expect(result.ok).toBe(false);
    expect(gateway.save).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("does not persist when the audit adapter fails", async () => {
    const gateway: ProductCategoryAdministrationGateway = {
      list: vi.fn().mockResolvedValue({
        restaurants: [{ id: restaurantId, name: "Carnales" }],
        categories: [],
      }),
      save: vi.fn(),
    };
    const service = new ProductCategoryAdministrationService(
      gateway,
      new AuditEventService(
        {
          append: async () => {
            throw new Error("audit unavailable");
          },
        },
        { now: () => new Date("2026-08-24T12:00:00.000Z") },
      ),
      () => categoryId,
    );

    const result = await service.save(actorId, {
      restaurantId,
      name: "Bebidas",
      displayOrder: "1",
      isActive: true,
    });
    expect(result.ok).toBe(false);
    expect(gateway.save).not.toHaveBeenCalled();
  });
});
