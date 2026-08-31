import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "prisma/migrations/20260830100000_cancel_orders_atomically/migration.sql",
  "utf8",
);
const probe = readFileSync(
  "prisma/probes/T-045-order-cancellation-rollback-probes.sql",
  "utf8",
);

describe("order cancellation migration", () => {
  it("keeps cancellation permission-derived, service-only, and serialized by the order", () => {
    expect(sql).toContain("CREATE FUNCTION public.cancel_order(");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("permission.code = 'orders.cancel'");
    expect(sql).toMatch(
      /FROM public\.orders AS target[\s\S]+FOR UPDATE OF target/,
    );
    expect(sql).not.toMatch(/role\.code\s*=|role_code\s*=/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.cancel_order\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cancel_order\([\s\S]+TO service_role/,
    );
  });

  it("allows only pending or ready orders and preserves immutable cancellation history", () => {
    expect(sql).toContain("target_order.status NOT IN ('PENDING', 'READY')");
    expect(sql).toContain("ORDER_CANCELLATION_NOT_CANCELLABLE");
    expect(sql).toContain("INSERT INTO public.order_cancellations");
    expect(sql).toMatch(
      /SET status = 'CANCELLED', updated_at = cancellation_time/,
    );
    expect(sql).not.toMatch(
      /DELETE FROM public\.(?:orders|order_cancellations)/i,
    );
  });

  it("locks inventory deterministically and appends only positive residual source-linked rollbacks", () => {
    expect(sql).toMatch(
      /ORDER BY inventory_item\.id[\s\S]+FOR UPDATE OF inventory_item/,
    );
    expect(sql).toContain("sale.business_origin_type = 'SALE'");
    expect(sql).toContain("sale.business_origin_id = target_order.id");
    expect(sql).toContain(
      "-sale.quantity_delta - COALESCE(sum(reversal.quantity_delta), 0)",
    );
    expect(sql).toContain("HAVING -sale.quantity_delta");
    expect(sql).toMatch(
      /'ROLLBACK',[\s\S]+source_sale\.residual_quantity[\s\S]+source_sale\.id/,
    );
    expect(sql).not.toMatch(/UPDATE public\.inventory_movements/i);
    expect(sql).not.toMatch(/DELETE FROM public\.inventory_movements/i);
  });

  it("audits inventory compensation and the order before/after transition", () => {
    expect(sql).toContain("'inventory_movement.rollback_recorded'");
    expect(sql).toContain("'order.cancelled'");
    expect(sql).toContain("previous_values, new_values, source_ip");
    expect(sql).toContain("'cancelledById', actor_user_id");
    expect(sql).toContain("'reason', cancellation_reason");
  });

  it("ships rollback-only behavior probes for finality, authorization, residuals, and atomicity", () => {
    expect(probe).toMatch(/^BEGIN;/);
    expect(probe).toMatch(/ROLLBACK;\s*$/);
    expect(probe).toContain("unauthorized cancellation was accepted");
    expect(probe).toContain(
      "PENDING cancellation did not restore residual resale stock",
    );
    expect(probe).toContain(
      "READY cancellation did not preserve previous state",
    );
    expect(probe).toContain("duplicate cancellation was accepted");
    expect(probe).toContain(
      "failed provenance cancellation persisted partial state",
    );
  });
});
