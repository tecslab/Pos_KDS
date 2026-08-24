import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
const path = new URL(
  "./migrations/20260824110000_manage_payment_methods_atomically/migration.sql",
  import.meta.url,
);

describe("payment method administration RPC", () => {
  it("atomically binds the exact audit snapshot to create/edit/activation", async () => {
    const sql = await readFile(path, "utf8");
    expect(sql).toContain("CREATE FUNCTION public.save_payment_method");
    expect(sql).toContain(
      "audit_event -> 'previousValues' IS DISTINCT FROM previous_values",
    );
    expect(sql).toContain("INSERT INTO public.payment_methods");
    expect(sql).toContain("INSERT INTO public.audit_events");
    expect(sql).toContain("payment_method.deactivated");
    expect(sql).not.toMatch(/DELETE FROM public\.payment_methods/i);
  });

  it("preserves future JSON keys while changing only approved bank and receipt fields", async () => {
    const sql = await readFile(path, "utf8");
    expect(sql).toContain(
      "next_bank := COALESCE(current_method.bank_account_configuration",
    );
    expect(sql).toContain(
      "next_receipt := COALESCE(current_method.receipt_configuration",
    );
    expect(sql).toContain("next_bank := next_bank || jsonb_build_object");
    expect(sql).toContain("next_receipt := next_receipt || jsonb_build_object");
  });

  it("is service-role-only and protects tenant ownership", async () => {
    const sql = await readFile(path, "utf8");
    expect(sql).toContain(
      "WHERE id = target_method_id AND restaurant_id = target_restaurant_id FOR UPDATE",
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]+TO service_role/);
  });
});
