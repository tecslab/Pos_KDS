import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "prisma/migrations/20260902090000_register_payments_atomically/migration.sql",
  "utf8",
);
const probe = readFileSync(
  "prisma/probes/T-054-payment-registration-rollback-probes.sql",
  "utf8",
);

describe("payment registration migration", () => {
  it("adds the administrator-only overage permission and a service-only RPC", () => {
    expect(sql).toContain("'payments.overage.authorize'");
    expect(sql).toContain("WHERE role.code = 'administrator'");
    expect(sql).toContain("CREATE FUNCTION public.register_payment(");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.register_payment\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.register_payment\([\s\S]+TO service_role/,
    );
  });

  it("rechecks permission, tenancy, active method, Delivered state, and overage evidence", () => {
    const functionBody = sql.slice(sql.indexOf("CREATE FUNCTION"));
    expect(sql).toContain("permission.code = 'payments.register'");
    expect(sql).toContain("permission.code = 'payments.overage.authorize'");
    expect(functionBody).not.toMatch(/role\.code\s*=|role_code\s*=/i);
    expect(sql).toMatch(
      /FROM public\.orders AS target[\s\S]+FOR UPDATE OF target/,
    );
    expect(sql).toContain("target_order.status <> 'DELIVERED'");
    expect(sql).toContain("method.restaurant_id = target_order.restaurant_id");
    expect(sql).toContain("method.is_active");
    expect(sql).toContain("PAYMENT_OVERAGE_REASON_REQUIRED");
    expect(sql).toContain("PAYMENT_OVERAGE_UNAUTHORIZED");
  });

  it("atomically appends immutable history and settles basket then order", () => {
    expect(sql).toContain("INSERT INTO public.payments");
    expect(sql).toMatch(/SET status = 'PAID',[\s\S]+paid_at = payment_time/);
    expect(sql).toContain("AND unsettled_basket.status <> 'PAID'");
    expect(sql).toContain("INSERT INTO public.audit_events");
    expect(sql).toContain("'payment.registered'");
    expect(sql).toContain("'basketOutstandingBefore', outstanding_before");
    expect(sql).toContain("'overageReason', normalized_overage_reason");
    expect(sql).not.toMatch(
      /DELETE FROM public\.(?:payments|customer_baskets|orders|audit_events)/i,
    );
  });

  it("ships rollback-only executable coverage for settlement and atomic failure", () => {
    expect(probe).toMatch(/^BEGIN;/);
    expect(probe).toMatch(/ROLLBACK;\s*$/);
    expect(probe).toContain("partial basket payment did not persist correctly");
    expect(probe).toContain(
      "exact basket settlement changed the wrong aggregate state",
    );
    expect(probe).toContain(
      "authorized overage or all-basket settlement evidence is incomplete",
    );
    expect(probe).toContain("payment after Paid was accepted");
    expect(probe).toContain("payment history mutation was accepted");
    expect(probe).toContain("audit history mutation was accepted");
    expect(probe).toContain(
      "audit failure did not roll back payment and settlement atomically",
    );
    expect(probe).toContain("CREATE TRIGGER t054_force_payment_audit_failure");
  });
});
