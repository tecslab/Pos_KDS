import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Product } from "../../application";
import { SupabaseProductAdministrationGateway } from "./supabase-product-administration-gateway";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const categoryId = "33000000-0000-4000-8000-000000000001";
const productId = "35000000-0000-4000-8000-000000000001";
const versionId = "36000000-0000-4000-8000-000000000002";
const taxRateId = "34000000-0000-4000-8000-000000000001";

function rows() {
  return {
    restaurants: [{ id: restaurantId, name: "Carnales" }],
    product_catalogs: [{ restaurant_id: restaurantId }],
    product_categories: [
      {
        id: categoryId,
        restaurant_id: restaurantId,
        name: "Tacos",
        is_active: true,
      },
    ],
    restaurant_tax_rates: [
      {
        id: taxRateId,
        restaurant_id: restaurantId,
        code: "IVA",
        name: "IVA 15%",
        rate: "0.150000",
        is_active: true,
      },
    ],
    products: [
      {
        id: productId,
        restaurant_id: restaurantId,
        category_id: categoryId,
        display_order: 2,
        is_active: true,
      },
    ],
    product_versions: [
      {
        id: "36000000-0000-4000-8000-000000000001",
        restaurant_id: restaurantId,
        product_id: productId,
        version_number: 1,
        name: "Taco anterior",
        unit_price: "4.00",
        printer_alias: "COCINA",
        tax_rate_id: taxRateId,
        tax_code: "IVA",
        tax_name: "IVA 15%",
        tax_rate: "0.150000",
        price_includes_tax: true,
        recipe_id: null,
        resale_inventory_item_id: null,
      },
      {
        id: versionId,
        restaurant_id: restaurantId,
        product_id: productId,
        version_number: 2,
        name: "Taco mixto",
        unit_price: "4.50",
        printer_alias: "COCINA",
        tax_rate_id: taxRateId,
        tax_code: "IVA",
        tax_name: "IVA 15%",
        tax_rate: "0.150000",
        price_includes_tax: true,
        recipe_id: null,
        resale_inventory_item_id: null,
      },
    ],
    product_options: [
      {
        id: "37000000-0000-4000-8000-000000000001",
        restaurant_id: restaurantId,
        product_version_id: versionId,
        name: "Extra queso",
        price_adjustment: "0.50",
        display_order: 0,
      },
    ],
    product_removable_ingredients: [
      {
        id: "38000000-0000-4000-8000-000000000001",
        restaurant_id: restaurantId,
        product_version_id: versionId,
        name: "Sin cebolla",
        price_adjustment: null,
        display_order: 0,
      },
    ],
    recipes: [
      {
        id: "85000000-0000-4000-8000-000000000001",
        restaurant_id: restaurantId,
        product_id: productId,
        name: "Taco base",
      },
    ],
    inventory_items: [
      {
        id: "71000000-0000-4000-8000-000000000001",
        restaurant_id: restaurantId,
        name: "Agua mineral",
        unit_of_measure: "unidad",
      },
    ],
  };
}

function clientFor(data: ReturnType<typeof rows>) {
  const from = vi.fn((table: keyof typeof data) => query(data[table]));
  return {
    client: { from } as unknown as SupabaseClient,
    from,
  };
}

function query(data: readonly unknown[]) {
  const response = Promise.resolve({ data, error: null });
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    then: response.then.bind(response),
  };
  return builder;
}

describe("SupabaseProductAdministrationGateway", () => {
  it("strictly assembles only the latest product version and its references", async () => {
    const { client, from } = clientFor(rows());
    const gateway = new SupabaseProductAdministrationGateway(client);

    await expect(gateway.list()).resolves.toMatchObject({
      restaurants: [{ name: "Carnales" }],
      categories: [{ name: "Tacos" }],
      taxRates: [{ rate: 0.15 }],
      recipes: [{ name: "Taco base", productId }],
      resaleItems: [{ name: "Agua mineral", unitOfMeasure: "unidad" }],
      products: [
        {
          id: productId,
          name: "Taco mixto",
          versionNumber: 2,
          unitPrice: 4.5,
          options: [{ name: "Extra queso", priceAdjustment: 0.5 }],
          removableIngredients: [
            { name: "Sin cebolla", priceAdjustment: null },
          ],
        },
      ],
    });
    expect(from).toHaveBeenCalledWith("recipes");
    expect(from).toHaveBeenCalledWith("inventory_items");
  });

  it("fails closed on malformed persistence rows", async () => {
    const data = rows();
    data.product_versions[1] = {
      ...data.product_versions[1],
      unit_price: "not-money",
    };
    const gateway = new SupabaseProductAdministrationGateway(
      clientFor(data).client,
    );
    await expect(gateway.list()).rejects.toThrow("Product persistence failed");
  });

  it("binds the staged audit to the single atomic save_product RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{}], error: null });
    const gateway = new SupabaseProductAdministrationGateway({
      rpc,
    } as unknown as SupabaseClient);
    const product: Product = Object.freeze({
      id: productId,
      restaurantId,
      restaurantName: "Carnales",
      categoryId,
      categoryName: "Tacos",
      displayOrder: 2,
      isActive: true,
      versionId,
      versionNumber: 3,
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
      options: [],
      removableIngredients: [],
    });
    await gateway.append({
      actorId,
      occurredAt: "2026-08-24T13:00:00.000Z",
      action: "product.updated",
      entityType: "product",
      entityId: productId,
      previousValues: {},
      newValues: {},
      sourceIp: null,
    });

    await expect(gateway.save(actorId, product)).resolves.toEqual(product);
    expect(rpc).toHaveBeenCalledWith("save_product", {
      actor_user_id: actorId,
      target_restaurant_id: restaurantId,
      target_product_id: productId,
      target_product_version_id: versionId,
      expected_previous_version_number: 2,
      target_category_id: categoryId,
      product_display_order: 2,
      product_is_active: true,
      product_name: "Taco mixto",
      product_unit_price: 4.5,
      product_printer_alias: "COCINA",
      target_tax_rate_id: taxRateId,
      product_price_includes_tax: true,
      target_recipe_id: null,
      target_resale_inventory_item_id: null,
      product_options_text: "[]",
      product_removals_text: "[]",
      audit_event_text: expect.stringContaining('"entityType":"product"'),
    });
  });

  it("fails closed without a matching staged audit", async () => {
    const rpc = vi.fn();
    const gateway = new SupabaseProductAdministrationGateway({
      rpc,
    } as unknown as SupabaseClient);
    const product = {} as Product;
    await expect(gateway.save(actorId, product)).rejects.toThrow(
      "Product persistence failed",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
