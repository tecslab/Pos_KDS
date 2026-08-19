import { describe, expect, it } from "vitest";

import {
  evaluatePermission,
  type PermissionCode,
  type PermissionSubject,
  type RolePermissionGrant,
} from "./permission-evaluator";

const matrixPermissions = [
  "orders.create",
  "orders.edit",
  "orders.cancel",
  "orders.view",
  "kitchen.queue.view",
  "kitchen.ready.mark",
  "delivery.panel.view",
  "delivery.on_the_way.mark",
  "delivery.delivered.mark",
  "payments.register",
  "inventory.view",
  "inventory.purchases.register",
  "inventory.waste.register",
  "inventory.adjustments.register",
  "production.batch.create",
  "production.recipes.edit",
  "reports.view",
  "reports.export",
  "administration.products.manage",
  "administration.users.manage",
  "audit.log.view",
] as const satisfies readonly PermissionCode[];

const initialRoleGrants = {
  administrator: {
    roleCode: "administrator",
    permissionCodes: matrixPermissions,
  },
  waiter: {
    roleCode: "waiter",
    permissionCodes: [
      "orders.create",
      "orders.edit",
      "orders.view",
      "delivery.panel.view",
      "delivery.on_the_way.mark",
      "delivery.delivered.mark",
      "payments.register",
    ],
  },
  kitchenPersonnel: {
    roleCode: "kitchen_personnel",
    permissionCodes: [
      "orders.view",
      "kitchen.queue.view",
      "kitchen.ready.mark",
    ],
  },
} as const satisfies Record<string, RolePermissionGrant>;

function subject(
  ...roleGrants: readonly RolePermissionGrant[]
): PermissionSubject {
  return { isActive: true, roleGrants };
}

describe("evaluatePermission", () => {
  it.each(Object.values(initialRoleGrants))(
    "enforces every matrix grant and denial for $roleCode",
    (roleGrant) => {
      const grantedPermissions = new Set<PermissionCode>(
        roleGrant.permissionCodes,
      );

      for (const permission of matrixPermissions) {
        const result = evaluatePermission(subject(roleGrant), permission);

        if (grantedPermissions.has(permission)) {
          expect(result).toEqual({ ok: true, value: undefined });
        } else {
          expect(result).toEqual({
            ok: false,
            error: { kind: "business-error", code: "UNAUTHORIZED" },
          });
        }
      }
    },
  );

  it("denies the ungranted future refund permission for every initial role", () => {
    for (const roleGrant of Object.values(initialRoleGrants)) {
      expect(evaluatePermission(subject(roleGrant), "payments.refund")).toEqual(
        {
          ok: false,
          error: { kind: "business-error", code: "UNAUTHORIZED" },
        },
      );
    }
  });

  it("denies inactive and roleless subjects", () => {
    expect(
      evaluatePermission(
        {
          isActive: false,
          roleGrants: [initialRoleGrants.administrator],
        },
        "orders.view",
      ),
    ).toEqual({
      ok: false,
      error: { kind: "business-error", code: "UNAUTHORIZED" },
    });

    expect(evaluatePermission(subject(), "orders.view")).toEqual({
      ok: false,
      error: { kind: "business-error", code: "UNAUTHORIZED" },
    });
  });

  it("combines multiple roles without changing the outcome for duplicates", () => {
    const combined = subject(
      initialRoleGrants.waiter,
      initialRoleGrants.kitchenPersonnel,
      initialRoleGrants.waiter,
    );

    expect(evaluatePermission(combined, "kitchen.ready.mark").ok).toBe(true);
    expect(evaluatePermission(combined, "delivery.delivered.mark").ok).toBe(
      true,
    );
    expect(evaluatePermission(combined, "orders.cancel").ok).toBe(false);
  });

  it("accepts future roles through their grants without evaluator changes", () => {
    const cashier = {
      roleCode: "cashier",
      permissionCodes: ["payments.register", "payments.view"],
    } satisfies RolePermissionGrant;

    expect(evaluatePermission(subject(cashier), "payments.view").ok).toBe(true);
    expect(evaluatePermission(subject(cashier), "orders.create").ok).toBe(
      false,
    );
  });

  it("matches exact permission codes and gives no role code special treatment", () => {
    const nominalAdministrator = {
      roleCode: "administrator",
      permissionCodes: [],
    } satisfies RolePermissionGrant;
    const customRole = {
      roleCode: "custom_role",
      permissionCodes: ["orders.view"],
    } satisfies RolePermissionGrant;

    expect(
      evaluatePermission(subject(nominalAdministrator), "orders.view").ok,
    ).toBe(false);
    expect(evaluatePermission(subject(customRole), "orders.view").ok).toBe(
      true,
    );
    expect(evaluatePermission(subject(customRole), "ORDERS.VIEW").ok).toBe(
      false,
    );
    expect(evaluatePermission(subject(customRole), "orders").ok).toBe(false);
  });

  it("does not mutate subjects or role grants", () => {
    const permissionCodes = Object.freeze(["orders.view"]);
    const roleGrant = Object.freeze({
      roleCode: "read_only_auditor",
      permissionCodes,
    });
    const roleGrants = Object.freeze([roleGrant]);
    const authorizationSubject = Object.freeze({
      isActive: true,
      roleGrants,
    });

    expect(evaluatePermission(authorizationSubject, "orders.view").ok).toBe(
      true,
    );
    expect(authorizationSubject.roleGrants).toBe(roleGrants);
    expect(authorizationSubject.roleGrants[0]?.permissionCodes).toBe(
      permissionCodes,
    );
  });
});
