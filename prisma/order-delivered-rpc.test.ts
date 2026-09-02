import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "prisma/migrations/20260901110000_mark_orders_delivered_atomically/migration.sql",
  "utf8",
);
const probe = readFileSync(
  "prisma/probes/T-053-order-delivered-rollback-probes.sql",
  "utf8",
);

describe("order Delivered migration", () => {
  it("is permission-derived, service-only, and serialized by the order", () => {
    expect(sql).toContain("CREATE FUNCTION public.mark_order_delivered(");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("permission.code = 'delivery.delivered.mark'");
    expect(sql).toMatch(
      /FROM public\.orders AS target[\s\S]+FOR UPDATE OF target/,
    );
    expect(sql).not.toMatch(/role\.code\s*=|role_code\s*=/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.mark_order_delivered\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.mark_order_delivered\([\s\S]+TO service_role/,
    );
  });

  it("allows only On the Way and atomically records actor, timestamp, and audit", () => {
    expect(sql).toContain("target_order.status <> 'ON_THE_WAY'");
    expect(sql).toContain("ORDER_DELIVERED_NOT_ON_THE_WAY");
    expect(sql).toMatch(
      /SET status = 'DELIVERED',[\s\S]+delivered_at = delivery_time,[\s\S]+updated_at = delivery_time/,
    );
    expect(sql).toContain("INSERT INTO public.audit_events");
    expect(sql).toContain("'order.delivered'");
    expect(sql).toContain("'deliveredById', actor_user_id");
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
    expect(probe).toContain("unauthorized Delivered transition was accepted");
    expect(probe).toContain(
      "Delivered transition did not persist state and audit",
    );
    expect(probe).toContain("duplicate Delivered transition was accepted");
  });
});
