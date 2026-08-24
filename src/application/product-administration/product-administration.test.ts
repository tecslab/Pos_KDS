import { describe, expect, it, vi } from "vitest";

import { AuditEventService, type AuditEventRecord } from "../audit";
import {
  ProductAdministrationService,
  type Product,
  type ProductAdministrationGateway,
  type ProductAdministrationView,
} from "./product-administration";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const categoryId = "33000000-0000-4000-8000-000000000001";
const taxRateId = "34000000-0000-4000-8000-000000000001";
const productId = "35000000-0000-4000-8000-000000000001";
const recipeId = "85000000-0000-4000-8000-000000000001";
const resaleItemId = "71000000-0000-4000-8000-000000000001";

const current: Product = Object.freeze({
  id: productId,
  restaurantId,
  restaurantName: "Carnales",
  categoryId,
  categoryName: "Tacos",
  displayOrder: 1,
  isActive: true,
  versionId: "36000000-0000-4000-8000-000000000001",
  versionNumber: 2,
  name: "Taco mixto",
  unitPrice: 4.5,
  printerAlias: "COCINA",
  taxRateId,
  taxCode: "IVA",
  taxName: "IVA 15%",
  taxRate: 0.15,
  priceIncludesTax: true,
  recipeId: null,
  resaleInventoryItemId: null,
  options: [
    {
      id: "37000000-0000-4000-8000-000000000001",
      name: "Extra queso",
      priceAdjustment: 0.5,
      displayOrder: 0,
    },
  ],
  removableIngredients: [],
});

function view(
  products: readonly Product[] = [current],
): ProductAdministrationView {
  return {
    restaurants: [{ id: restaurantId, name: "Carnales" }],
    categories: [
      { id: categoryId, restaurantId, name: "Tacos", isActive: true },
    ],
    taxRates: [
      {
        id: taxRateId,
        restaurantId,
        code: "IVA",
        name: "IVA 15%",
        rate: 0.15,
        isActive: true,
      },
    ],
    recipes: [{ id: recipeId, restaurantId, productId, name: "Taco base" }],
    resaleItems: [
      {
        id: resaleItemId,
        restaurantId,
        name: "Agua mineral",
        unitOfMeasure: "unidad",
      },
    ],
    products,
  };
}

function setup(products: readonly Product[] = [current]) {
  const gateway: ProductAdministrationGateway = {
    list: vi.fn().mockResolvedValue(view(products)),
    save: vi.fn().mockImplementation(async (_actor, product) => product),
  };
  const events: AuditEventRecord[] = [];
  let sequence = 1;
  const createId = () =>
    `90000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
  return {
    gateway,
    events,
    service: new ProductAdministrationService(
      gateway,
      new AuditEventService(
        { append: async (event) => void events.push(event) },
        { now: () => new Date("2026-08-24T13:00:00.000Z") },
      ),
      createId,
    ),
  };
}

describe("ProductAdministrationService", () => {
  it("lists all product configuration references", async () => {
    const result = await setup().service.list();
    expect(result).toMatchObject({
      ok: true,
      value: {
        restaurants: [{ name: "Carnales" }],
        categories: [{ name: "Tacos" }],
        taxRates: [{ code: "IVA" }],
        recipes: [{ name: "Taco base" }],
        resaleItems: [{ name: "Agua mineral" }],
        products: [{ name: "Taco mixto", versionNumber: 2 }],
      },
    });
  });

  it("creates version one with normalized options, removals, tax and audit snapshot", async () => {
    const { service, gateway, events } = setup([]);
    const result = await service.save(actorId, {
      restaurantId,
      categoryId,
      displayOrder: "2",
      isActive: true,
      name: "  Agua   mineral ",
      unitPrice: "2.25",
      printerAlias: " BARRA ",
      taxRateId,
      priceIncludesTax: true,
      resaleInventoryItemId: resaleItemId,
      optionLines: "Con gas\nFría | 0.25",
      removableIngredientLines: "Sin hielo | -0.10",
    });

    expect(result.ok).toBe(true);
    expect(gateway.save).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({
        versionNumber: 1,
        name: "Agua mineral",
        unitPrice: 2.25,
        taxCode: "IVA",
        taxRate: 0.15,
        recipeId: null,
        resaleInventoryItemId: resaleItemId,
        options: [
          expect.objectContaining({
            name: "Con gas",
            priceAdjustment: null,
            displayOrder: 0,
          }),
          expect.objectContaining({
            name: "Fría",
            priceAdjustment: 0.25,
            displayOrder: 1,
          }),
        ],
        removableIngredients: [
          expect.objectContaining({
            name: "Sin hielo",
            priceAdjustment: -0.1,
          }),
        ],
      }),
    );
    expect(events[0]).toMatchObject({
      action: "product.created",
      entityType: "product",
      entityId: expect.any(String),
      previousValues: null,
      newValues: {
        versionNumber: 1,
        priceIncludesTax: true,
        resaleInventoryItemId: resaleItemId,
      },
    });
  });

  it.each(["0.29", "0.57", "2.03", "10.12"])(
    "accepts valid two-decimal unit price and adjustment %s",
    async (money) => {
      const { service, gateway } = setup([]);
      const result = await service.save(actorId, {
        restaurantId,
        categoryId,
        displayOrder: "2",
        isActive: true,
        name: "Producto decimal",
        unitPrice: money,
        printerAlias: "COCINA",
        taxRateId,
        priceIncludesTax: true,
        optionLines: `Opción decimal | ${money}`,
        removableIngredientLines: `Sin extra | -${money}`,
      });

      expect(result.ok).toBe(true);
      expect(gateway.save).toHaveBeenCalledWith(
        actorId,
        expect.objectContaining({
          unitPrice: Number(money),
          options: [
            expect.objectContaining({ priceAdjustment: Number(money) }),
          ],
          removableIngredients: [
            expect.objectContaining({ priceAdjustment: -Number(money) }),
          ],
        }),
      );
    },
  );

  it("creates N+1 with fresh immutable child identities and recipe reference", async () => {
    const { service, gateway, events } = setup();
    const result = await service.save(actorId, {
      id: productId,
      restaurantId,
      categoryId,
      displayOrder: "4",
      isActive: true,
      name: "Taco mixto grande",
      unitPrice: "5.00",
      printerAlias: "COCINA",
      taxRateId,
      priceIncludesTax: true,
      recipeId,
      optionLines: "Extra queso | 0.75",
      removableIngredientLines: "Sin cebolla",
    });

    expect(result.ok).toBe(true);
    const saved = vi.mocked(gateway.save).mock.calls[0]?.[1];
    expect(saved).toMatchObject({
      id: productId,
      versionNumber: 3,
      recipeId,
      resaleInventoryItemId: null,
    });
    expect(saved?.versionId).not.toBe(current.versionId);
    expect(saved?.options[0]?.id).not.toBe(current.options[0]?.id);
    expect(events[0]).toMatchObject({
      action: "product.updated",
      previousValues: { versionId: current.versionId, versionNumber: 2 },
      newValues: { versionNumber: 3, recipeId },
    });
  });

  it("audits deactivation while still producing the next historical version", async () => {
    const { service, events } = setup();
    expect(
      (
        await service.save(actorId, {
          id: productId,
          restaurantId,
          categoryId,
          displayOrder: "1",
          isActive: false,
          name: current.name,
          unitPrice: "4.50",
          printerAlias: current.printerAlias,
          taxRateId,
          priceIncludesTax: true,
          optionLines: "Extra queso | 0.50",
          removableIngredientLines: "",
        })
      ).ok,
    ).toBe(true);
    expect(events[0]).toMatchObject({
      action: "product.deactivated",
      newValues: { isActive: false, versionNumber: 3 },
    });
  });

  it.each([
    { label: "negative price", override: { unitPrice: "-1" } },
    { label: "fractional order", override: { displayOrder: "1.5" } },
    {
      label: "duplicate options",
      override: { optionLines: "Grande\ngrande | 1.00" },
    },
    {
      label: "both inventory strategies",
      override: { recipeId, resaleInventoryItemId: resaleItemId },
    },
  ])("rejects $label before audit and persistence", async ({ override }) => {
    const { service, gateway, events } = setup();
    const result = await service.save(actorId, {
      id: productId,
      restaurantId,
      categoryId,
      displayOrder: "1",
      isActive: true,
      name: current.name,
      unitPrice: "4.50",
      printerAlias: current.printerAlias,
      taxRateId,
      priceIncludesTax: true,
      optionLines: "Extra queso | 0.50",
      removableIngredientLines: "",
      ...override,
    });
    expect(result.ok).toBe(false);
    expect(gateway.save).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("fails closed for an out-of-scope recipe or resale link", async () => {
    const { service, gateway, events } = setup();
    vi.mocked(gateway.list).mockResolvedValue({
      ...view(),
      recipes: [],
    });
    const result = await service.save(actorId, {
      id: productId,
      restaurantId,
      categoryId,
      displayOrder: "1",
      isActive: true,
      name: current.name,
      unitPrice: "4.50",
      printerAlias: current.printerAlias,
      taxRateId,
      priceIncludesTax: true,
      recipeId,
      optionLines: "",
      removableIngredientLines: "",
    });
    expect(result.ok).toBe(false);
    expect(gateway.save).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("does not persist when centralized audit staging fails", async () => {
    const gateway: ProductAdministrationGateway = {
      list: vi.fn().mockResolvedValue(view()),
      save: vi.fn(),
    };
    const service = new ProductAdministrationService(
      gateway,
      new AuditEventService(
        {
          append: async () => {
            throw new Error("audit unavailable");
          },
        },
        { now: () => new Date("2026-08-24T13:00:00.000Z") },
      ),
      () => "90000000-0000-4000-8000-000000000001",
    );
    const result = await service.save(actorId, {
      id: productId,
      restaurantId,
      categoryId,
      displayOrder: "1",
      isActive: true,
      name: current.name,
      unitPrice: "4.50",
      printerAlias: current.printerAlias,
      taxRateId,
      priceIncludesTax: true,
      optionLines: "",
      removableIngredientLines: "",
    });
    expect(result.ok).toBe(false);
    expect(gateway.save).not.toHaveBeenCalled();
  });
});
