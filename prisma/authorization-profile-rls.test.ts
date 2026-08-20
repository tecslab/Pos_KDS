import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260819100000_allow_authenticated_authorization_profile_reads/migration.sql",
  import.meta.url,
);

describe("authenticated authorization profile RLS", () => {
  it("adds one authenticated self-read policy across the persisted graph", async () => {
    const migration = await readFile(migrationPath, "utf8");

    for (const policy of [
      "application_users_select_self",
      "user_role_assignments_select_self",
      "roles_select_assigned_to_self",
      "role_permissions_select_assigned_to_self",
      "permissions_select_granted_to_self",
    ]) {
      expect(migration).toContain(`CREATE POLICY ${policy}`);
    }

    expect(migration.match(/CREATE POLICY/g)).toHaveLength(5);
    expect(migration.match(/FOR SELECT/g)).toHaveLength(5);
    expect(migration.match(/TO authenticated/g)).toHaveLength(5);
    expect(migration).toContain("id = (SELECT auth.uid())");
    expect(migration).toContain("user_id = (SELECT auth.uid())");
    expect(migration).toContain(
      "current_user_role.user_id = (SELECT auth.uid())",
    );
  });

  it("does not grant writes, public access, direct user permissions, or bypasses", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).not.toMatch(/FOR\s+(?:ALL|INSERT|UPDATE|DELETE)/i);
    expect(migration).not.toMatch(/TO\s+(?:anon|public)/i);
    expect(migration).not.toMatch(/\bGRANT\b|service_role|SECURITY DEFINER/i);
    expect(migration).not.toMatch(/user_permissions/i);
  });
});
