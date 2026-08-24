import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const path = new URL(
  "./migrations/20260824090000_manage_service_locations_atomically/migration.sql",
  import.meta.url,
);

describe("service-location administration RPC", () => {
  it("supports atomic create/edit/state/order/multiple-order settings", async () => {
    const sql = await readFile(path, "utf8");
    expect(sql).toContain("CREATE FUNCTION public.save_service_location");
    expect(sql).toContain("ON CONFLICT (id) DO UPDATE");
    expect(sql).toContain("display_order = EXCLUDED.display_order");
    expect(sql).toContain("is_active = EXCLUDED.is_active");
    expect(sql).toContain(
      "allows_multiple_active_orders = EXCLUDED.allows_multiple_active_orders",
    );
    expect(sql).not.toMatch(/location_type\s+IN\s*\(/i);
  });

  it("locks, detects stale snapshots, and appends one immutable audit event", async () => {
    const sql = await readFile(path, "utf8");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("audit snapshot is stale");
    expect(sql).toContain("service_location.activated");
    expect(sql).toContain("service_location.deactivated");
    expect(sql).toContain("expected_action text");
    expect(sql).toContain(
      "audit_event ->> 'action' IS DISTINCT FROM expected_action",
    );
    expect(sql).not.toContain("IS DISTINCT FROM CASE");
    expect(sql).toContain("INSERT INTO public.audit_events");
    expect(sql).toMatch(/REVOKE ALL[\s\S]+FROM PUBLIC, anon, authenticated/);
  });
});
