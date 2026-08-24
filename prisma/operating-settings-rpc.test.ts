import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260823190000_preserve_future_operating_configuration/migration.sql",
  import.meta.url,
);

describe("atomic restaurant operating settings RPC", () => {
  it("updates only approved settings with bounds and target locks", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql.match(/FOR UPDATE/g)).toHaveLength(3);
    expect(sql).toContain("opens_at >= closes_at");
    expect(sql).toContain("tax_rate < 0 OR tax_rate > 1");
    expect(sql).toContain("tax name is invalid");
    expect(sql).toContain(
      "preparation_critical_minutes < preparation_warning_minutes",
    );
    expect(sql).toContain(
      "delivery_critical_minutes < delivery_warning_minutes",
    );
    expect(sql).toContain("audit_event := printing_mode::jsonb");
    expect(sql).not.toMatch(
      /address\s*=|tax_id\s*=|logo_url\s*=|thermal_printer_configuration\s*=/i,
    );
  });

  it("atomically appends immutable before/after audit snapshots", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("INSERT INTO public.audit_events");
    expect(sql).toContain("restaurant.operating_settings_updated");
    expect(sql).toContain("previous_values");
    expect(sql).toContain("new_values");
    expect(sql).toContain("'allowNegativeStock'");
    expect(sql).not.toMatch(/printing_behavior\s*=/);
    expect(sql).toContain("jsonb_set(");
    expect(sql).toContain("current_configuration.inventory_policy");
    expect(sql).toContain("current_configuration.business_hours");
    expect(sql).toContain("#>> '{daily,opensAt}'");
    expect(sql).toContain("audit snapshot is stale");
  });

  it("is restricted to the trusted server role", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toMatch(/REVOKE ALL[\s\S]+FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE[\s\S]+TO service_role/);
  });
});
