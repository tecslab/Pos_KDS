import { describe, expect, it } from "vitest";

import { buildNavigation, roleLabel } from "./navigation";

function ids(permissionCodes: readonly string[]) {
  return buildNavigation(permissionCodes).map((item) => item.id);
}

describe("buildNavigation", () => {
  it("shows a waiter's operational modules from persisted permission grants", () => {
    expect(
      ids([
        "orders.create",
        "orders.edit",
        "orders.view",
        "delivery.panel.view",
        "payments.register",
      ]),
    ).toEqual(["home", "orders", "delivery", "payments"]);
  });

  it("keeps kitchen navigation minimal and excludes financial/admin modules", () => {
    expect(
      ids(["orders.view", "kitchen.queue.view", "kitchen.ready.mark"]),
    ).toEqual(["home", "kitchen"]);
  });

  it("combines permissions across roles without consulting role names", () => {
    expect(
      ids([
        "inventory.view",
        "production.batch.create",
        "reports.view",
        "administration.products.manage",
        "audit.log.view",
      ]),
    ).toEqual([
      "home",
      "inventory",
      "production",
      "reports",
      "administration",
      "audit",
    ]);
  });

  it("supports future roles through permission data and ignores malformed grants", () => {
    expect(
      ids(["payments.view", " future.invalid", "unknown.permission"]),
    ).toEqual(["home", "payments"]);
  });

  it("returns detached immutable presentation data and no premature module links", () => {
    const navigation = buildNavigation(["orders.create", "reports.view"]);

    expect(Object.isFrozen(navigation)).toBe(true);
    expect(navigation.every(Object.isFrozen)).toBe(true);
    expect(
      navigation.filter((item) => item.available).map((item) => item.id),
    ).toEqual(["home"]);
  });

  it("enables administration for each implemented exact permission", () => {
    const unrelatedAdministration = buildNavigation([
      "administration.products.manage",
    ]).find((item) => item.id === "administration");
    const userAdministration = buildNavigation([
      "administration.users.manage",
    ]).find((item) => item.id === "administration");

    expect(unrelatedAdministration).toMatchObject({
      available: true,
      href: "/administration/products",
    });
    expect(userAdministration).toMatchObject({
      available: true,
      href: "/administration/users",
    });
  });

  it("routes restaurant configurators to the settings screen", () => {
    expect(
      buildNavigation(["administration.restaurant.configure"]).find(
        (item) => item.id === "administration",
      ),
    ).toMatchObject({ href: "/administration/settings", available: true });
  });

  it("routes location administrators to service-location administration", () => {
    expect(
      buildNavigation(["administration.locations.manage"]).find(
        (item) => item.id === "administration",
      ),
    ).toMatchObject({ href: "/administration/locations", available: true });
  });

  it("routes payment configurators to payment-method administration", () => {
    expect(
      buildNavigation(["administration.payment_methods.configure"]).find(
        (item) => item.id === "administration",
      ),
    ).toMatchObject({
      href: "/administration/payment-methods",
      available: true,
    });
  });

  it("routes category-only administrators to product-category administration", () => {
    expect(
      buildNavigation(["administration.categories.manage"]).find(
        (item) => item.id === "administration",
      ),
    ).toMatchObject({
      href: "/administration/categories",
      available: true,
    });
  });

  it("routes product-only administrators to product administration", () => {
    expect(
      buildNavigation(["administration.products.manage"]).find(
        (item) => item.id === "administration",
      ),
    ).toMatchObject({
      href: "/administration/products",
      available: true,
    });
  });

  it("preserves established administration-route priority when category access is combined", () => {
    expect(
      buildNavigation([
        "administration.locations.manage",
        "administration.payment_methods.configure",
        "administration.categories.manage",
        "administration.products.manage",
      ]).find((item) => item.id === "administration"),
    ).toMatchObject({ href: "/administration/locations", available: true });
  });
});

describe("roleLabel", () => {
  it.each([
    ["administrator", "Administrador"],
    ["waiter", "Mesero"],
    ["kitchen_personnel", "Personal de cocina"],
    ["branch_manager", "Rol adicional"],
    ["", "Rol asignado"],
  ])("localizes %s as %s", (roleCode, expected) => {
    expect(roleLabel(roleCode)).toBe(expected);
  });
});
