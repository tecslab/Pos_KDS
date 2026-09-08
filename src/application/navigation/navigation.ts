export type NavigationIcon =
  | "home"
  | "orders"
  | "kitchen"
  | "delivery"
  | "payments"
  | "inventory"
  | "production"
  | "reports"
  | "administration"
  | "audit";

export type NavigationItem = Readonly<{
  id: NavigationIcon;
  label: string;
  href: string;
  icon: NavigationIcon;
  available: boolean;
}>;

type NavigationDefinition = NavigationItem &
  Readonly<{ requiredAnyPermissionCodes: readonly string[] }>;

const navigationDefinitions: readonly NavigationDefinition[] = Object.freeze([
  definition("home", "Inicio", "/", [], true),
  definition("orders", "Punto de venta", "/orders", ["orders.create"], true),
  definition("kitchen", "Cocina", "/kitchen", ["kitchen.queue.view"], true),
  definition("delivery", "Entregas", "/delivery", ["delivery.panel.view"]),
  definition("payments", "Pagos", "/payments", ["payments.view"], true),
  definition(
    "inventory",
    "Inventario",
    "/inventory",
    [
      "inventory.purchases.register",
      "inventory.adjustments.register",
      "inventory.waste.register",
    ],
    true,
  ),
  definition(
    "production",
    "Producción",
    "/production",
    [
      "production.batch.create",
      "production.recipes.edit",
      "production.history.view",
    ],
    true,
  ),
  definition("reports", "Reportes", "/reports", [
    "reports.view",
    "reports.export",
  ]),
  definition(
    "administration",
    "Administración",
    "/administration/users",
    [
      "administration.users.manage",
      "administration.roles.manage",
      "administration.products.manage",
      "administration.inventory.manage",
      "administration.categories.manage",
      "administration.locations.manage",
      "administration.restaurant.configure",
      "administration.payment_methods.configure",
      "administration.printers.configure",
    ],
    true,
  ),
  definition("audit", "Auditoría", "/audit", ["audit.log.view"], true),
]);

export function buildNavigation(
  grantedPermissionCodes: readonly string[],
): readonly NavigationItem[] {
  const grants = new Set(
    Array.isArray(grantedPermissionCodes)
      ? grantedPermissionCodes.filter(isCanonicalCode)
      : [],
  );

  return Object.freeze(
    navigationDefinitions
      .filter(
        (item) =>
          item.requiredAnyPermissionCodes.length === 0 ||
          item.requiredAnyPermissionCodes.some((permission) =>
            grants.has(permission),
          ),
      )
      .map((item) =>
        Object.freeze({
          id: item.id,
          label: item.label,
          href:
            item.id === "administration" &&
            !grants.has("administration.users.manage") &&
            (grants.has("administration.restaurant.configure") ||
              grants.has("administration.locations.manage") ||
              grants.has("administration.payment_methods.configure") ||
              grants.has("administration.categories.manage") ||
              grants.has("administration.products.manage") ||
              grants.has("administration.inventory.manage"))
              ? grants.has("administration.restaurant.configure")
                ? "/administration/settings"
                : grants.has("administration.locations.manage")
                  ? "/administration/locations"
                  : grants.has("administration.payment_methods.configure")
                    ? "/administration/payment-methods"
                    : grants.has("administration.categories.manage")
                      ? "/administration/categories"
                      : grants.has("administration.products.manage")
                        ? "/administration/products"
                        : "/administration/inventory-items"
              : item.href,
          icon: item.icon,
          available:
            item.available &&
            (item.id !== "production" ||
              grants.has("production.recipes.edit")) &&
            (item.id !== "administration" ||
              grants.has("administration.users.manage") ||
              grants.has("administration.restaurant.configure") ||
              grants.has("administration.locations.manage") ||
              grants.has("administration.payment_methods.configure") ||
              grants.has("administration.categories.manage") ||
              grants.has("administration.products.manage") ||
              grants.has("administration.inventory.manage")),
        }),
      ),
  );
}

export function roleLabel(roleCode: string): string {
  const knownRoles: Readonly<Record<string, string>> = Object.freeze({
    administrator: "Administrador",
    kitchen_personnel: "Personal de cocina",
    waiter: "Mesero",
  });

  if (knownRoles[roleCode]) {
    return knownRoles[roleCode];
  }

  return roleCode.trim().length === 0 ? "Rol asignado" : "Rol adicional";
}

function definition(
  id: NavigationIcon,
  label: string,
  href: string,
  requiredAnyPermissionCodes: readonly string[],
  available = false,
): NavigationDefinition {
  return Object.freeze({
    id,
    label,
    href,
    icon: id,
    available,
    requiredAnyPermissionCodes: Object.freeze(requiredAnyPermissionCodes),
  });
}

function isCanonicalCode(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.trim() === value
  );
}
