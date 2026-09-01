import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "prisma/migrations/20260901090000_mark_orders_ready_atomically/migration.sql",
  "utf8",
);
const probe = readFileSync(
  "prisma/probes/T-049-order-ready-rollback-probes.sql",
  "utf8",
);

describe("order Ready migration", () => {
  it("is permission-derived, service-only, and serialized by the order", () => {
    expect(sql).toContain("CREATE FUNCTION public.mark_order_ready(");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("permission.code = 'kitchen.ready.mark'");
    expect(sql).toMatch(
      /FROM public\.orders AS target[\s\S]+FOR UPDATE OF target/,
    );
    expect(sql).not.toMatch(/role\.code\s*=|role_code\s*=/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.mark_order_ready\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.mark_order_ready\([\s\S]+TO service_role/,
    );
  });

  it("allows only Pending and atomically timestamps and audits Ready", () => {
    expect(sql).toContain("target_order.status <> 'PENDING'");
    expect(sql).toContain("ORDER_READY_NOT_PENDING");
    expect(sql).toMatch(
      /SET status = 'READY', ready_at = ready_time, updated_at = ready_time/,
    );
    expect(sql).toContain("INSERT INTO public.audit_events");
    expect(sql).toContain("'order.ready'");
    expect(sql).toContain("previous_values, new_values, source_ip");
    expect(sql).not.toMatch(/DELETE FROM public\.(?:orders|audit_events)/i);
  });

  it("returns an operational projection without financial fields", () => {
    const returnProjection = sql.match(
      /RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE plpgsql/,
    )?.[1];

    expect(returnProjection).toBeDefined();
    expect(returnProjection).not.toMatch(/total|price|balance|payment|amount/i);
  });

  it("ships rollback-only probes for permission, finality, and atomicity", () => {
    expect(probe).toMatch(/^BEGIN;/);
    expect(probe).toMatch(/ROLLBACK;\s*$/);
    expect(probe).toContain("unauthorized Ready transition was accepted");
    expect(probe).toContain("Ready transition did not persist state and audit");
    expect(probe).toContain("duplicate Ready transition was accepted");
  });
});
