import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260905100000_grant_payment_receipt_print_permission/migration.sql",
  import.meta.url,
);
const seedPath = new URL("./seeds/development.sql", import.meta.url);

describe("payment receipt print permission", () => {
  it("idempotently grants the permission to Administrator and Waiter", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("permission.code = 'payments.receipt.print'");
    expect(sql).toContain("role.code IN ('administrator', 'waiter')");
    expect(sql).toContain("ON CONFLICT (role_id, permission_id) DO NOTHING");
  });

  it("excludes Kitchen without changing custom-role grants", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const deletion = sql.slice(sql.indexOf("DELETE FROM"));

    expect(deletion).toContain("role.code = 'kitchen_personnel'");
    expect(deletion).toContain("permission.code = 'payments.receipt.print'");
    expect(deletion).not.toMatch(/role\.code\s+NOT IN/i);
    expect(sql).not.toMatch(/DELETE[\s\S]+role\.code IN \('administrator'/i);
  });

  it("keeps the development seed reconciled with the approved initial mapping", async () => {
    const seed = await readFile(seedPath, "utf8");

    expect(seed).toContain("('administrator', 'payments.receipt.print')");
    expect(seed).toContain("('waiter', 'payments.receipt.print')");
    expect(seed).not.toContain(
      "('kitchen_personnel', 'payments.receipt.print')",
    );
  });
});
