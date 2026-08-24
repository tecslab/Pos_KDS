import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import type { PaymentMethod } from "../../application";
import { SupabasePaymentMethodAdministrationGateway } from "./supabase-payment-method-administration-gateway";

const method: PaymentMethod = Object.freeze({
  id: "32000000-0000-4000-8000-000000000002",
  restaurantId: "30000000-0000-4000-8000-000000000001",
  restaurantName: "Carnales",
  code: "deuna",
  name: "DeUna",
  displayOrder: 2,
  isActive: true,
  isBankTransfer: true,
  bankName: "Banco",
  accountHolder: "Carnales",
  accountNumber: "1234",
  receiptHeader: "Gracias",
  receiptFooter: "Conserve su comprobante",
});
const actorId = "10000000-0000-4000-8000-000000000001";

it("stages the centralized audit event and calls only the atomic RPC", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [{}], error: null });
  const gateway = new SupabasePaymentMethodAdministrationGateway({
    rpc,
  } as unknown as SupabaseClient);
  await gateway.append({
    actorId,
    occurredAt: "2026-08-24T10:00:00Z",
    action: "payment_method.updated",
    entityType: "payment_method",
    entityId: method.id,
    previousValues: {},
    newValues: {},
    sourceIp: null,
  });
  await expect(gateway.save(actorId, method)).resolves.toEqual(method);
  expect(rpc).toHaveBeenCalledWith(
    "save_payment_method",
    expect.objectContaining({
      actor_user_id: actorId,
      method_code: "deuna",
      method_is_bank_transfer: true,
      bank_name: "Banco",
      receipt_header: "Gracias",
      audit_event_text: expect.stringContaining(
        '"entityType":"payment_method"',
      ),
    }),
  );
});

it("fails closed without the centralized staged audit event", async () => {
  const rpc = vi.fn();
  const gateway = new SupabasePaymentMethodAdministrationGateway({
    rpc,
  } as unknown as SupabaseClient);
  await expect(gateway.save(actorId, method)).rejects.toThrow(
    "Payment method persistence failed",
  );
  expect(rpc).not.toHaveBeenCalled();
});
