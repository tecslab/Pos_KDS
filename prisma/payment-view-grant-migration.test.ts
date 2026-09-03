import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260903100000_grant_payment_view_permission/migration.sql",
  import.meta.url,
);

describe("payment view permission migration", () => {
  it("idempotently grants payments.view to Administrator and Waiter", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("permission.code = 'payments.view'");
    expect(sql).toContain("role.code IN ('administrator', 'waiter')");
    expect(sql).toContain("ON CONFLICT (role_id, permission_id) DO NOTHING");
  });

  it("excludes Kitchen without changing custom-role grants", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const deletion = sql.slice(sql.indexOf("DELETE FROM"));

    expect(deletion).toContain("role.code = 'kitchen_personnel'");
    expect(deletion).toContain("permission.code = 'payments.view'");
    expect(deletion).not.toMatch(/role\.code\s+NOT IN/i);
    expect(sql).not.toMatch(/DELETE[\s\S]+role\.code IN \('administrator'/i);
  });
});
