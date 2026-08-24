import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";

import type { ProductCategory } from "../../application";
import { SupabaseProductCategoryAdministrationGateway } from "./supabase-product-category-administration-gateway";

const category: ProductCategory = Object.freeze({
  id: "33000000-0000-4000-8000-000000000001",
  restaurantId: "30000000-0000-4000-8000-000000000001",
  restaurantName: "Carnales",
  name: "Tacos",
  displayOrder: 2,
  isActive: true,
});
const actorId = "10000000-0000-4000-8000-000000000001";

it("lists configured restaurants independently and orders their categories", async () => {
  const from = vi.fn((table: string) => {
    if (table === "restaurants")
      return {
        select: () => ({
          eq: () => ({
            is: () =>
              Promise.resolve({
                data: [
                  { id: category.restaurantId, name: "Carnales" },
                  {
                    id: "30000000-0000-4000-8000-000000000002",
                    name: "Sin catálogo",
                  },
                ],
                error: null,
              }),
          }),
        }),
      };
    if (table === "product_catalogs")
      return {
        select: () => ({
          is: () =>
            Promise.resolve({
              data: [{ restaurant_id: category.restaurantId }],
              error: null,
            }),
        }),
      };
    return {
      select: () => ({
        is: () =>
          Promise.resolve({
            data: [
              {
                id: "33000000-0000-4000-8000-000000000002",
                restaurant_id: category.restaurantId,
                name: "Bebidas",
                display_order: 3,
                is_active: false,
              },
              {
                id: category.id,
                restaurant_id: category.restaurantId,
                name: category.name,
                display_order: 2,
                is_active: true,
              },
            ],
            error: null,
          }),
      }),
    };
  });
  const gateway = new SupabaseProductCategoryAdministrationGateway({
    from,
  } as unknown as SupabaseClient);

  await expect(gateway.list()).resolves.toMatchObject({
    restaurants: [{ id: category.restaurantId, name: "Carnales" }],
    categories: [
      { name: "Tacos", displayOrder: 2, isActive: true },
      { name: "Bebidas", displayOrder: 3, isActive: false },
    ],
  });
  expect(from).toHaveBeenCalledWith("product_catalogs");
});

it("stages the centralized audit event and calls only the atomic category RPC", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [{}], error: null });
  const gateway = new SupabaseProductCategoryAdministrationGateway({
    rpc,
  } as unknown as SupabaseClient);
  await gateway.append({
    actorId,
    occurredAt: "2026-08-24T12:00:00.000Z",
    action: "product_category.reordered",
    entityType: "product_category",
    entityId: category.id,
    previousValues: {},
    newValues: {},
    sourceIp: null,
  });

  await expect(gateway.save(actorId, category)).resolves.toEqual(category);
  expect(rpc).toHaveBeenCalledWith("save_product_category", {
    actor_user_id: actorId,
    target_restaurant_id: category.restaurantId,
    target_category_id: category.id,
    category_name: "Tacos",
    category_display_order: 2,
    category_is_active: true,
    audit_event_text: expect.stringContaining(
      '"entityType":"product_category"',
    ),
  });
});

it("fails closed without the centralized staged audit event", async () => {
  const rpc = vi.fn();
  const gateway = new SupabaseProductCategoryAdministrationGateway({
    rpc,
  } as unknown as SupabaseClient);

  await expect(gateway.save(actorId, category)).rejects.toThrow(
    "Product category persistence failed",
  );
  expect(rpc).not.toHaveBeenCalled();
});
