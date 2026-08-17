import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const schemaPath = new URL("./schema.prisma", import.meta.url);
const migrationPath = new URL(
  "./migrations/20260816180000_create_immutable_payment_history_schema/migration.sql",
  import.meta.url,
);

describe("immutable payment history schema", () => {
  it("models basket payments with method and actor snapshots", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("model Payment");
    for (const field of [
      "restaurantId",
      "basketId",
      "paymentMethodId",
      "recordedById",
      "amount",
      "paymentMethodCode",
      "paymentMethodName",
      "referenceNumber",
      "comments",
      "recordedAt",
      "overageAuthorizedById",
      "overageAuthorizedAt",
      "overageReason",
    ]) {
      expect(schema).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }

    expect(schema).toMatch(/amount\s+Decimal\s+@db\.Decimal\(12, 2\)/);
    expect(schema).toContain("recordedPayments   Payment[]");
    expect(schema).toContain("authorizedOverages Payment[]");
    expect(schema).toContain("payments     Payment[]");
    expect(schema).toContain("@@unique([restaurantId, id])");
  });

  it("keeps basket and configured-method references in the same restaurant", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "ADD CONSTRAINT payment_methods_restaurant_id_id_key UNIQUE (restaurant_id, id)",
    );
    expect(migration).toContain(
      "FOREIGN KEY (restaurant_id, basket_id) REFERENCES public.customer_baskets(restaurant_id, id)",
    );
    expect(migration).toContain(
      "FOREIGN KEY (restaurant_id, payment_method_id) REFERENCES public.payment_methods(restaurant_id, id)",
    );
    expect(migration).toContain(
      "FOREIGN KEY (recorded_by_id) REFERENCES public.application_users(id)",
    );
    expect(migration).toContain(
      "FOREIGN KEY (overage_authorized_by_id) REFERENCES public.application_users(id)",
    );
    expect(migration).toContain("ON DELETE RESTRICT ON UPDATE RESTRICT");
  });

  it("requires a positive amount and complete privileged-overage evidence", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "CONSTRAINT payments_amount_positive CHECK (amount > 0)",
    );
    expect(migration).toContain(
      "CONSTRAINT payments_method_code_not_blank CHECK (btrim(payment_method_code) <> '')",
    );
    expect(migration).toContain(
      "CONSTRAINT payments_method_name_not_blank CHECK (btrim(payment_method_name) <> '')",
    );
    expect(migration).toContain(
      "CONSTRAINT payments_overage_evidence_all_or_none CHECK",
    );
    for (const field of [
      "overage_authorized_by_id",
      "overage_authorized_at",
      "overage_reason",
    ]) {
      expect(migration).toContain(`${field} IS NULL`);
      expect(migration).toContain(`${field} IS NOT NULL`);
    }
    expect(migration).toContain("btrim(overage_reason) <> ''");
  });

  it("serializes basket balance validation and allows only evidenced overage", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "CREATE FUNCTION public.validate_payment_balance()",
    );
    expect(migration).toContain("FROM public.customer_baskets");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("SELECT COALESCE(sum(amount), 0)");
    expect(migration).toContain(
      "recorded_total + NEW.amount > basket_total AND NOT has_overage_evidence",
    );
    expect(migration).toContain(
      "payment exceeds the customer basket outstanding balance",
    );
    expect(migration).toContain("CREATE TRIGGER payments_validate_balance");
    expect(migration).toContain("BEFORE INSERT ON public.payments");
    expect(migration).not.toContain("UPDATE public.customer_baskets");
    expect(migration).not.toContain("UPDATE public.orders");
  });

  it("makes history immutable and leaves RLS default-deny without seed data", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const names = [
      ...migration.matchAll(
        /^(?:\\s*(?:ADD )?CONSTRAINT\\s+|CREATE (?:UNIQUE )?INDEX\\s+|CREATE (?:CONSTRAINT )?TRIGGER\\s+|CREATE (?:TABLE|FUNCTION) public\\.)([a-z][a-z0-9_]*)/gm,
      ),
    ].map((match) => match[1]);

    expect(migration).toContain(
      "CREATE FUNCTION public.reject_payment_history_mutation()",
    );
    expect(migration).toContain("CREATE TRIGGER payments_immutable");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON public.payments");
    expect(migration).toContain(
      "ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY",
    );
    expect(migration).not.toMatch(/\\bCREATE\\s+POLICY\\b/i);
    expect(migration).not.toMatch(/\\bINSERT\\s+INTO\\b/i);
    expect(names.every((name) => Buffer.byteLength(name, "utf8") <= 63)).toBe(
      true,
    );
    expect(new Set(names).size).toBe(names.length);
  });
});
