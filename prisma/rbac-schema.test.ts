import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const schemaPath = new URL("./schema.prisma", import.meta.url);
const migrationPath = new URL(
  "./migrations/20260816103000_create_rbac_employee_audit_schema/migration.sql",
  import.meta.url,
);

describe("RBAC and audit schema", () => {
  it("models RBAC through roles without direct user permissions", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const model of [
      "ApplicationUser",
      "Role",
      "Permission",
      "UserRoleAssignment",
      "RolePermission",
      "AuditEvent",
    ]) {
      expect(schema).toContain(`model ${model}`);
    }

    expect(schema).toContain("@@id([userId, roleId])");
    expect(schema).toContain("@@id([roleId, permissionId])");
    expect(schema).not.toMatch(/model\s+UserPermission\b/);
  });

  it("uses migration constraints for authenticated users and immutable audits", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("REFERENCES auth.users(id) ON DELETE RESTRICT");
    expect(migration).toContain("previous_values jsonb");
    expect(migration).toContain("new_values jsonb");
    expect(migration).toContain("source_ip inet");
    expect(migration).toContain(
      "CREATE CONSTRAINT TRIGGER application_users_require_role",
    );
    expect(migration).toContain("CREATE TRIGGER audit_events_immutable");
    expect(migration).toContain(
      "BEFORE UPDATE OR DELETE ON public.audit_events",
    );
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
  });
});
