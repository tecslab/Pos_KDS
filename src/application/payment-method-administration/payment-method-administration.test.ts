import { describe, expect, it, vi } from "vitest";
import { AuditEventService, type AuditEventRecord } from "../audit";
import {
  PaymentMethodAdministrationService,
  type PaymentMethod,
  type PaymentMethodAdministrationGateway,
} from "./payment-method-administration";

const actorId = "10000000-0000-4000-8000-000000000001";
const methodId = "32000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const current: PaymentMethod = Object.freeze({
  id: methodId,
  restaurantId,
  restaurantName: "Carnales",
  code: "cash",
  name: "Efectivo",
  displayOrder: 1,
  isActive: true,
  isBankTransfer: false,
  bankName: "",
  accountHolder: "",
  accountNumber: "",
  receiptHeader: "",
  receiptFooter: "",
});
function setup(existing: readonly PaymentMethod[] = [current]) {
  const gateway: PaymentMethodAdministrationGateway = {
    list: vi.fn().mockResolvedValue(existing),
    save: vi.fn().mockImplementation(async (_actor, method) => method),
  };
  const events: AuditEventRecord[] = [];
  const audit = new AuditEventService(
    { append: async (event) => void events.push(event) },
    { now: () => new Date("2026-08-24T10:00:00Z") },
  );
  return {
    gateway,
    events,
    service: new PaymentMethodAdministrationService(
      gateway,
      audit,
      () => methodId,
    ),
  };
}
const input = {
  restaurantId,
  code: "transfer_future",
  name: "Transferencia futura",
  displayOrder: "4",
  isActive: true,
  isBankTransfer: true,
  bankName: "Banco",
  accountHolder: "Carnales",
  accountNumber: "1234",
  receiptHeader: "Gracias",
  receiptFooter: "Conserve su comprobante",
};

describe("PaymentMethodAdministrationService", () => {
  it("creates a configurable bank method with receipt layout and complete audit", async () => {
    const { service, gateway, events } = setup([]);
    expect((await service.save(actorId, input)).ok).toBe(true);
    expect(gateway.save).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({
        code: "transfer_future",
        bankName: "Banco",
        receiptHeader: "Gracias",
      }),
    );
    expect(events[0]).toMatchObject({
      action: "payment_method.created",
      entityType: "payment_method",
      previousValues: null,
      newValues: {
        isBankTransfer: true,
        receiptFooter: "Conserve su comprobante",
      },
    });
  });

  it("audits deactivation without deleting or rewriting payment history", async () => {
    const { service, events } = setup();
    const result = await service.save(actorId, {
      ...input,
      id: methodId,
      code: "cash",
      name: "Efectivo",
      isActive: false,
      isBankTransfer: false,
      bankName: "",
      accountHolder: "",
      accountNumber: "",
    });
    expect(result.ok).toBe(true);
    expect(events[0]).toMatchObject({
      action: "payment_method.deactivated",
      previousValues: { name: "Efectivo", isActive: true },
      newValues: { isActive: false },
    });
  });

  it.each([
    { code: "Bad code" },
    { name: " " },
    { displayOrder: "-1" },
    { isBankTransfer: false, bankName: "Banco" },
  ])(
    "rejects invalid configuration before audit and persistence",
    async (override) => {
      const { service, gateway, events } = setup([]);
      expect((await service.save(actorId, { ...input, ...override })).ok).toBe(
        false,
      );
      expect(gateway.save).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    },
  );
});
