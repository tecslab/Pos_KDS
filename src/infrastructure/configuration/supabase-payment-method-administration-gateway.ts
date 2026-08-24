import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AuditEventAppender,
  AuditEventRecord,
  PaymentMethod,
  PaymentMethodAdministrationGateway,
} from "../../application";

export class SupabasePaymentMethodAdministrationGateway
  implements PaymentMethodAdministrationGateway, AuditEventAppender
{
  private pendingAudit: AuditEventRecord | null = null;
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<readonly PaymentMethod[]> {
    try {
      const [restaurants, methods] = await Promise.all([
        this.client
          .from("restaurants")
          .select("id, name")
          .eq("is_active", true)
          .is("deleted_at", null),
        this.client
          .from("payment_methods")
          .select(
            "id, restaurant_id, code, name, display_order, is_active, bank_account_configuration, receipt_configuration",
          )
          .is("deleted_at", null),
      ]);
      if (
        restaurants.error ||
        methods.error ||
        !Array.isArray(restaurants.data) ||
        !Array.isArray(methods.data)
      )
        throw new Error();
      const names = new Map(restaurants.data.map((row) => [row.id, row.name]));
      return Object.freeze(
        methods.data
          .map((row) => mapMethod(row, names))
          .sort(
            (a, b) =>
              a.displayOrder - b.displayOrder ||
              a.name.localeCompare(b.name, "es"),
          ),
      );
    } catch {
      throw new Error("Payment method persistence failed.");
    }
  }

  async save(actorId: string, method: PaymentMethod): Promise<PaymentMethod> {
    try {
      const audit = this.pendingAudit;
      if (!audit || audit.actorId !== actorId || audit.entityId !== method.id)
        throw new Error();
      const { data, error } = await this.client.rpc("save_payment_method", {
        actor_user_id: actorId,
        target_restaurant_id: method.restaurantId,
        target_method_id: method.id,
        method_code: method.code,
        method_name: method.name,
        method_display_order: method.displayOrder,
        method_is_active: method.isActive,
        method_is_bank_transfer: method.isBankTransfer,
        bank_name: method.bankName,
        bank_account_holder: method.accountHolder,
        bank_account_number: method.accountNumber,
        receipt_header: method.receiptHeader,
        receipt_footer: method.receiptFooter,
        audit_event_text: JSON.stringify(audit),
      });
      if (error || !Array.isArray(data) || data.length !== 1) throw new Error();
      return Object.freeze(method);
    } catch {
      throw new Error("Payment method persistence failed.");
    } finally {
      this.pendingAudit = null;
    }
  }

  async append(event: AuditEventRecord) {
    if (this.pendingAudit) throw new Error("Audit transaction is busy.");
    this.pendingAudit = event;
  }
}

function mapMethod(row: unknown, names: Map<unknown, unknown>): PaymentMethod {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.code !== "string" ||
    typeof row.name !== "string" ||
    !Number.isInteger(row.display_order) ||
    typeof row.is_active !== "boolean" ||
    typeof names.get(row.restaurant_id) !== "string"
  )
    throw new Error();
  const bank = isRecord(row.bank_account_configuration)
    ? row.bank_account_configuration
    : {};
  const receipt = isRecord(row.receipt_configuration)
    ? row.receipt_configuration
    : {};
  return Object.freeze({
    id: row.id,
    restaurantId: row.restaurant_id,
    restaurantName: names.get(row.restaurant_id) as string,
    code: row.code,
    name: row.name,
    displayOrder: row.display_order as number,
    isActive: row.is_active,
    isBankTransfer: bank.kind === "BANK_TRANSFER",
    bankName: text(bank.bankName),
    accountHolder: text(bank.accountHolder),
    accountNumber: text(bank.accountNumber),
    receiptHeader: text(receipt.header),
    receiptFooter: text(receipt.footer),
  });
}
function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
