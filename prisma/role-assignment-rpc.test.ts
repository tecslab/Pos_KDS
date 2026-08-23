import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260822100000_assign_application_user_roles_atomically/migration.sql",
  import.meta.url,
);

describe("atomic application-user role assignment RPC", () => {
  it("validates a nonempty unique set of existing roles", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("cardinality(desired_role_ids) = 0");
    expect(sql).toContain("array_position(desired_role_ids, NULL)");
    expect(sql).toContain(
      "cardinality(normalized_role_ids) <> cardinality(desired_role_ids)",
    );
    expect(sql).toContain("one or more roles do not exist");
  });

  it("serializes and atomically reconciles profile and multi-role membership", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("FOR KEY SHARE");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("INSERT INTO public.application_users");
    expect(sql).toContain("DELETE FROM public.user_role_assignments");
    expect(sql).toContain("INSERT INTO public.user_role_assignments");
    expect(sql).toContain("ON CONFLICT (user_id, role_id) DO NOTHING");
    expect(sql).toContain("previous_role_ids uuid[]");
    expect(sql).toContain("assigned_role_ids uuid[]");
  });

  it("is server-only and exposes no direct user-permission mutation", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toMatch(/REVOKE ALL[\s\S]+FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE[\s\S]+TO service_role/);
    expect(sql).not.toMatch(
      /user_permissions|permission_ids|role_permissions\s*\(/i,
    );
  });
});
