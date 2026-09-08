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
        "payments.view",
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

  it("makes payments reachable only with its exact view permission", () => {
    expect(
      buildNavigation(["payments.view"]).find((item) => item.id === "payments"),
    ).toMatchObject({ href: "/payments", available: true });
    expect(
      buildNavigation(["payments.register"]).find(
        (item) => item.id === "payments",
      ),
    ).toBeUndefined();
  });

  it("makes inventory reachable with its exact view permission", () => {
    expect(
      buildNavigation(["inventory.view"]).find(
        (item) => item.id === "inventory",
      ),
    ).toMatchObject({ href: "/inventory", available: true });
    for (const permission of [
      "inventory.purchases.register",
      "inventory.adjustments.register",
      "inventory.waste.register",
    ]) {
      expect(
        buildNavigation([permission]).find((item) => item.id === "inventory"),
      ).toBeUndefined();
    }
  });

  it("returns detached immutable presentation data and makes implemented modules reachable", () => {
    const navigation = buildNavigation([
      "orders.create",
      "kitchen.queue.view",
      "reports.view",
    ]);

    expect(Object.isFrozen(navigation)).toBe(true);
    expect(navigation.every(Object.isFrozen)).toBe(true);
    expect(
      navigation.filter((item) => item.available).map((item) => item.id),
    ).toEqual(["home", "orders", "kitchen"]);
  });

  it("makes the PoS reachable only with orders.create, matching its page boundary", () => {
    expect(
      buildNavigation(["orders.create"]).find((item) => item.id === "orders"),
    ).toMatchObject({ href: "/orders", available: true });
    expect(
      buildNavigation(["orders.edit"]).find((item) => item.id === "orders"),
    ).toBeUndefined();
  });

  it("makes the KDS reachable only with its exact queue-view permission", () => {
    expect(
      buildNavigation(["kitchen.queue.view"]).find(
        (item) => item.id === "kitchen",
      ),
    ).toMatchObject({ href: "/kitchen", available: true });
    expect(
      buildNavigation(["kitchen.ready.mark"]).find(
        (item) => item.id === "kitchen",
      ),
    ).toBeUndefined();
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

  it("makes implemented recipe administration available to authorized users", () => {
    expect(
      buildNavigation(["production.recipes.edit"]).find(
        (item) => item.id === "production",
      ),
    ).toMatchObject({ href: "/production", available: true });
  });

  it("makes the audit log reachable only with its exact persisted permission", () => {
    expect(
      buildNavigation(["audit.log.view"]).find((item) => item.id === "audit"),
    ).toMatchObject({ href: "/audit", available: true });
    expect(
      buildNavigation(["reports.view"]).find((item) => item.id === "audit"),
    ).toBeUndefined();
  });

  it.each(["production.batch.create", "production.history.view"])(
    "keeps production visible but unavailable with only %s",
    (permission) => {
      expect(
        buildNavigation([permission]).find((item) => item.id === "production"),
      ).toMatchObject({ href: "/production", available: false });
    },
  );

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
