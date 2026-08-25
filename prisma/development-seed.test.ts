import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const seedPath = new URL("./seeds/development.sql", import.meta.url);

const initialRoleMatrix = [
  ["administrator", "orders.create"],
  ["administrator", "orders.edit"],
  ["administrator", "orders.cancel"],
  ["administrator", "orders.view"],
  ["administrator", "kitchen.queue.view"],
  ["administrator", "kitchen.ready.mark"],
  ["administrator", "delivery.panel.view"],
  ["administrator", "delivery.on_the_way.mark"],
  ["administrator", "delivery.delivered.mark"],
  ["administrator", "payments.register"],
  ["administrator", "inventory.view"],
  ["administrator", "administration.inventory.manage"],
  ["administrator", "inventory.purchases.register"],
  ["administrator", "inventory.waste.register"],
  ["administrator", "inventory.adjustments.register"],
  ["administrator", "production.batch.create"],
  ["administrator", "production.recipes.edit"],
  ["administrator", "reports.view"],
  ["administrator", "reports.export"],
  ["administrator", "administration.products.manage"],
  ["administrator", "administration.users.manage"],
  ["administrator", "administration.payment_methods.configure"],
  ["administrator", "audit.log.view"],
  ["waiter", "orders.create"],
  ["waiter", "orders.edit"],
  ["waiter", "orders.view"],
  ["waiter", "delivery.panel.view"],
  ["waiter", "delivery.on_the_way.mark"],
  ["waiter", "delivery.delivered.mark"],
  ["waiter", "payments.register"],
  ["kitchen_personnel", "orders.view"],
  ["kitchen_personnel", "kitchen.queue.view"],
  ["kitchen_personnel", "kitchen.ready.mark"],
];

function tuplesBetween(seed: string, start: string, end: string) {
  const section = seed.slice(seed.indexOf(start), seed.indexOf(end));

  return [...section.matchAll(/\('([^']+)', '([^']+)'\)/g)].map(
    ([, first, second]) => [first, second],
  );
}

describe("development seed", () => {
  it("seeds the PRD matrix plus approved Administrator-only administration grants", async () => {
    const seed = await readFile(seedPath, "utf8");

    for (const role of ["Administrator", "Waiter", "Kitchen Personnel"]) {
      expect(seed).toContain(`'${role}'`);
    }

    const matrix = tuplesBetween(
      seed,
      "INSERT INTO seed_desired_role_permissions",
      "DELETE FROM public.role_permissions",
    );

    expect(matrix).toEqual(initialRoleMatrix);
    expect(matrix.filter(([role]) => role === "administrator")).toHaveLength(
      23,
    );
    expect(matrix.filter(([role]) => role === "waiter")).toHaveLength(7);
    expect(
      matrix.filter(([role]) => role === "kitchen_personnel"),
    ).toHaveLength(3);
    expect(
      matrix.filter(
        ([role, permission]) =>
          permission === "administration.payment_methods.configure" &&
          role !== "administrator",
      ),
    ).toEqual([]);
  });

  it("seeds the complete PRD permission catalog without granting future refunds", async () => {
    const seed = await readFile(seedPath, "utf8");
    const permissionSection = seed.slice(
      seed.indexOf("INSERT INTO public.permissions"),
      seed.indexOf("CREATE TEMPORARY TABLE seed_desired_role_permissions"),
    );
    const permissionCodes = [
      ...permissionSection.matchAll(
        /\('20000000-[^']+', '([^']+)', '[^']+', (?:NULL|'[^']*')\)/g,
      ),
    ].map(([, code]) => code);

    expect(permissionCodes).toHaveLength(32);
    expect(new Set(permissionCodes).size).toBe(32);
    expect(permissionCodes).toContain("payments.refund");
    expect(initialRoleMatrix.flat()).not.toContain("payments.refund");
  });

  it("contains only the approved T-003 development baseline", async () => {
    const seed = await readFile(seedPath, "utf8");

    expect(seed).toContain("'Carnales — Mexican Grill'");
    expect(seed).toContain("0.150000");
    expect(seed).toContain("'{\"allowNegativeStock\": false}'::jsonb");
    expect(seed).toContain(
      `'{"daily": {"opensAt": "11:00", "closesAt": "22:00"}}'::jsonb`,
    );
    expect(seed).toContain("  5,\n  7,\n  6,\n  8,");

    const locationSection = seed.slice(
      seed.indexOf("INSERT INTO public.service_locations"),
      seed.indexOf("INSERT INTO public.payment_methods"),
    );
    expect(locationSection.match(/'Table \d+'/g)).toHaveLength(15);
    expect(locationSection).toContain(
      "'Dispatch Window', 'DISPATCH_WINDOW', 16, true, true, NULL",
    );
    expect(locationSection).not.toMatch(/'Table \d+'.*true, true, NULL/);

    for (const method of [
      "'cash', 'Cash'",
      "'deuna', 'DeUna'",
      "'jep_fast', 'JEP Fast'",
    ]) {
      expect(seed).toContain(method);
    }
  });

  it("is transaction-scoped, idempotent, and does not seed users or secrets", async () => {
    const seed = await readFile(seedPath, "utf8");

    expect(seed.trimStart()).toMatch(/^BEGIN;/);
    expect(seed.trimEnd()).toMatch(/COMMIT;$/);
    expect(seed).toContain("SET CONSTRAINTS ALL IMMEDIATE");
    expect(seed.match(/ON CONFLICT/g)).toHaveLength(8);
    expect(seed).toContain("ON CONFLICT (role_id, permission_id) DO NOTHING");
    expect(seed).toContain("DELETE FROM public.role_permissions");
    expect(seed).not.toMatch(
      /INSERT INTO public\.(application_users|user_role_assignments)/i,
    );
    expect(seed).not.toMatch(/auth\.users|password|access_token|api_key/i);
    expect(seed).not.toMatch(/\b(TRUNCATE|DROP TABLE)\b/i);
  });
});
