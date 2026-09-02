import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "prisma/migrations/20260901100000_mark_orders_on_the_way_atomically/migration.sql",
  "utf8",
);
const probe = readFileSync(
  "prisma/probes/T-052-order-on-the-way-rollback-probes.sql",
  "utf8",
);

describe("order On-the-Way migration", () => {
  it("is permission-derived, service-only, and serialized by the order", () => {
    expect(sql).toContain("CREATE FUNCTION public.mark_order_on_the_way(");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("permission.code = 'delivery.on_the_way.mark'");
    expect(sql).toMatch(
      /FROM public\.orders AS target[\s\S]+FOR UPDATE OF target/,
    );
    expect(sql).not.toMatch(/role\.code\s*=|role_code\s*=/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.mark_order_on_the_way\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.mark_order_on_the_way\([\s\S]+TO service_role/,
    );
  });

  it("allows only Ready and atomically records collector, timestamp, and audit", () => {
    expect(sql).toContain("target_order.status <> 'READY'");
    expect(sql).toContain("ORDER_ON_THE_WAY_NOT_READY");
    expect(sql).toMatch(
      /SET status = 'ON_THE_WAY',[\s\S]+on_the_way_at = handoff_time,[\s\S]+updated_at = handoff_time/,
    );
    expect(sql).toContain("INSERT INTO public.audit_events");
    expect(sql).toContain("'order.on-the-way'");
    expect(sql).toContain("'collectedById', actor_user_id");
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
    expect(probe).toContain("unauthorized On-the-Way transition was accepted");
    expect(probe).toContain(
      "On-the-Way transition did not persist state and audit",
    );
    expect(probe).toContain("duplicate On-the-Way transition was accepted");
  });
});
