import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { SupabasePosOrderingContextReader } from "./supabase-pos-ordering-context-reader";

const restaurantA = "30000000-0000-4000-8000-000000000001";
const restaurantB = "30000000-0000-4000-8000-000000000002";
const restaurantInactive = "30000000-0000-4000-8000-000000000003";
const categoryTacos = "33000000-0000-4000-8000-000000000001";
const categoryEmpty = "33000000-0000-4000-8000-000000000002";
const categoryInactive = "33000000-0000-4000-8000-000000000003";
const productId = "35000000-0000-4000-8000-000000000001";
const suppressedProductId = "35000000-0000-4000-8000-000000000002";
const oldVersionId = "36000000-0000-4000-8000-000000000001";
const latestVersionId = "36000000-0000-4000-8000-000000000002";
const suppressedVersionId = "36000000-0000-4000-8000-000000000003";
const taxRateId = "34000000-0000-4000-8000-000000000001";

type TestRow = Record<string, unknown>;
type TestData = Record<string, TestRow[]>;

function data(): TestData {
  return {
    restaurants: [
      {
        id: restaurantB,
        name: "Sucursal",
        is_active: true,
        deleted_at: null,
      },
      {
        id: restaurantA,
        name: "Carnales",
        is_active: true,
        deleted_at: null,
      },
      {
        id: restaurantInactive,
        name: "Oculto",
        is_active: false,
        deleted_at: null,
      },
    ],
    product_catalogs: [
      {
        restaurant_id: restaurantA,
        is_active: true,
        deleted_at: null,
      },
      {
        restaurant_id: restaurantB,
        is_active: false,
        deleted_at: null,
      },
    ],
    service_locations: [
      {
        id: "31000000-0000-4000-8000-000000000002",
        restaurant_id: restaurantA,
        name: "Mesa 2",
        type: "TABLE",
        display_order: 1,
        is_active: true,
        allows_multiple_active_orders: false,
        deleted_at: null,
      },
      {
        id: "31000000-0000-4000-8000-000000000001",
        restaurant_id: restaurantA,
        name: "Mesa 1",
        type: "TABLE",
        display_order: 1,
        is_active: true,
        allows_multiple_active_orders: false,
        deleted_at: null,
      },
      {
        id: "31000000-0000-4000-8000-000000000003",
        restaurant_id: restaurantB,
        name: "Ventana",
        type: "TAKEOUT",
        display_order: 0,
        is_active: true,
        allows_multiple_active_orders: true,
        deleted_at: null,
      },
      {
        id: "31000000-0000-4000-8000-000000000004",
        restaurant_id: restaurantA,
        name: "Inactiva",
        type: "TABLE",
        display_order: 0,
        is_active: false,
        allows_multiple_active_orders: false,
        deleted_at: null,
      },
    ],
    product_categories: [
      {
        id: categoryEmpty,
        restaurant_id: restaurantA,
        name: "Bebidas",
        display_order: 0,
        is_active: true,
        deleted_at: null,
      },
      {
        id: categoryTacos,
        restaurant_id: restaurantA,
        name: "Tacos",
        display_order: 1,
        is_active: true,
        deleted_at: null,
      },
      {
        id: categoryInactive,
        restaurant_id: restaurantA,
        name: "Oculta",
        display_order: 2,
        is_active: false,
        deleted_at: null,
      },
    ],
    products: [
      {
        id: productId,
        restaurant_id: restaurantA,
        category_id: categoryTacos,
        display_order: 2,
        is_active: true,
        deleted_at: null,
      },
      {
        id: suppressedProductId,
        restaurant_id: restaurantA,
        category_id: categoryInactive,
        display_order: 0,
        is_active: true,
        deleted_at: null,
      },
    ],
    product_versions: [
      {
        id: latestVersionId,
        restaurant_id: restaurantA,
        product_id: productId,
        version_number: 2,
        name: "Taco mixto",
        unit_price: "4.50",
        printer_alias: "COCINA",
        tax_rate_id: taxRateId,
        tax_code: "IVA-CAPTURADO",
        tax_name: "IVA histórico 15%",
        tax_rate: "0.150000",
        price_includes_tax: true,
      },
      {
        id: oldVersionId,
        restaurant_id: restaurantA,
        product_id: productId,
        version_number: 1,
        name: "Taco anterior",
        unit_price: "4.00",
        printer_alias: "COCINA",
        tax_rate_id: taxRateId,
        tax_code: "IVA",
        tax_name: "IVA 12%",
        tax_rate: "0.120000",
        price_includes_tax: true,
      },
      {
        id: suppressedVersionId,
        restaurant_id: restaurantA,
        product_id: suppressedProductId,
        version_number: 1,
        name: "Producto oculto",
        unit_price: "3.00",
        printer_alias: "COCINA",
        tax_rate_id: taxRateId,
        tax_code: "IVA",
        tax_name: "IVA 15%",
        tax_rate: "0.150000",
        price_includes_tax: true,
      },
    ],
    product_options: [
      {
        id: "37000000-0000-4000-8000-000000000003",
        restaurant_id: restaurantA,
        product_version_id: latestVersionId,
        name: "Sin costo",
        price_adjustment: "0.00",
        display_order: 1,
      },
      {
        id: "37000000-0000-4000-8000-000000000002",
        restaurant_id: restaurantA,
        product_version_id: latestVersionId,
        name: "Extra queso",
        price_adjustment: "0.50",
        display_order: 0,
      },
      {
        id: "37000000-0000-4000-8000-000000000001",
        restaurant_id: restaurantA,
        product_version_id: oldVersionId,
        name: "Opción anterior",
        price_adjustment: null,
        display_order: 0,
      },
    ],
    product_removable_ingredients: [
      {
        id: "38000000-0000-4000-8000-000000000001",
        restaurant_id: restaurantA,
        product_version_id: latestVersionId,
        name: "Sin cebolla",
        price_adjustment: null,
        display_order: 0,
      },
    ],
  };
}

function clientFor(source: TestData) {
  const from = vi.fn((table: string) => query(source[table] ?? []));
  return { client: { from } as unknown as SupabaseClient, from };
}

function query(source: TestRow[]) {
  const filters: Array<(row: TestRow) => boolean> = [];
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, expected: unknown) => {
      filters.push((row) => row[column] === expected);
      return builder;
    }),
    is: vi.fn((column: string, expected: unknown) => {
      filters.push((row) => row[column] === expected);
      return builder;
    }),
    then: <TResult1 = { data: TestRow[]; error: null }>(
      onfulfilled?:
        ((value: { data: TestRow[]; error: null }) => TResult1) | null,
    ) =>
      Promise.resolve({
        data: source.filter((row) => filters.every((filter) => filter(row))),
        error: null,
      }).then(onfulfilled),
  };
  return builder;
}

describe("SupabasePosOrderingContextReader", () => {
  it("assembles active data with latest-version snapshots and deterministic nesting", async () => {
    const { client, from } = clientFor(data());

    const context = await new SupabasePosOrderingContextReader(client).read();

    expect(context).toEqual({
      restaurants: [
        {
          id: restaurantA,
          name: "Carnales",
          serviceLocations: [
            {
              id: "31000000-0000-4000-8000-000000000001",
              name: "Mesa 1",
              type: "TABLE",
              displayOrder: 1,
              allowsMultipleActiveOrders: false,
            },
            {
              id: "31000000-0000-4000-8000-000000000002",
              name: "Mesa 2",
              type: "TABLE",
              displayOrder: 1,
              allowsMultipleActiveOrders: false,
            },
          ],
          categories: [
            {
              id: categoryEmpty,
              name: "Bebidas",
              displayOrder: 0,
              products: [],
            },
            {
              id: categoryTacos,
              name: "Tacos",
              displayOrder: 1,
              products: [
                {
                  id: productId,
                  productVersionId: latestVersionId,
                  versionNumber: 2,
                  name: "Taco mixto",
                  printerAlias: "COCINA",
                  displayOrder: 2,
                  unitPrice: 4.5,
                  tax: {
                    taxRateId,
                    code: "IVA-CAPTURADO",
                    name: "IVA histórico 15%",
                    rate: 0.15,
                    priceIncludesTax: true,
                  },
                  options: [
                    {
                      id: "37000000-0000-4000-8000-000000000002",
                      name: "Extra queso",
                      priceAdjustment: 0.5,
                      displayOrder: 0,
                    },
                    {
                      id: "37000000-0000-4000-8000-000000000003",
                      name: "Sin costo",
                      priceAdjustment: 0,
                      displayOrder: 1,
                    },
                  ],
                  removableIngredients: [
                    {
                      id: "38000000-0000-4000-8000-000000000001",
                      name: "Sin cebolla",
                      priceAdjustment: null,
                      displayOrder: 0,
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: restaurantB,
          name: "Sucursal",
          serviceLocations: [
            {
              id: "31000000-0000-4000-8000-000000000003",
              name: "Ventana",
              type: "TAKEOUT",
              displayOrder: 0,
              allowsMultipleActiveOrders: true,
            },
          ],
          categories: [],
        },
      ],
    });
    expect(from).toHaveBeenCalledTimes(8);
    expect(from).not.toHaveBeenCalledWith("restaurant_tax_rates");
    expect(JSON.stringify(context)).not.toContain("Opción anterior");
    expect(JSON.stringify(context)).not.toContain("Producto oculto");
  });

  it.each([
    {
      label: "malformed decimal",
      mutate: (rows: TestData) => {
        rows.product_versions[0].unit_price = "not-money";
      },
    },
    {
      label: "included product without a version",
      mutate: (rows: TestData) => {
        rows.product_versions = rows.product_versions.filter(
          (row) => row.product_id !== productId,
        );
        rows.product_options = [];
        rows.product_removable_ingredients = [];
      },
    },
    {
      label: "cross-restaurant modification",
      mutate: (rows: TestData) => {
        rows.product_options[0].restaurant_id = restaurantB;
      },
    },
    {
      label: "cross-restaurant product version",
      mutate: (rows: TestData) => {
        rows.product_versions[0].restaurant_id = restaurantB;
      },
    },
  ])("fails closed for $label", async ({ mutate }) => {
    const rows = data();
    mutate(rows);

    await expect(
      new SupabasePosOrderingContextReader(clientFor(rows).client).read(),
    ).rejects.toThrow("PoS ordering context persistence failed.");
  });

  it("sanitizes Supabase query failures", async () => {
    const response = Promise.resolve({
      data: null,
      error: new Error("private query detail"),
    });
    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      then: response.then.bind(response),
    };
    const client = {
      from: vi.fn(() => builder),
    } as unknown as SupabaseClient;

    await expect(
      new SupabasePosOrderingContextReader(client).read(),
    ).rejects.toThrow("PoS ordering context persistence failed.");
  });
});
