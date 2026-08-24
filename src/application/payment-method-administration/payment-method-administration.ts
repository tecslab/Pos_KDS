import { err, ok, type Result } from "../../domain";
import type { AuditEventService } from "../audit";

export type PaymentMethod = Readonly<{
  id: string;
  restaurantId: string;
  restaurantName: string;
  code: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  isBankTransfer: boolean;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  receiptHeader: string;
  receiptFooter: string;
}>;

export type SavePaymentMethodInput = Readonly<{
  id?: string;
  restaurantId: string;
  code: string;
  name: string;
  displayOrder: string;
  isActive: boolean;
  isBankTransfer: boolean;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  receiptHeader: string;
  receiptFooter: string;
}>;

export interface PaymentMethodAdministrationGateway {
  list(): Promise<readonly PaymentMethod[]>;
  save(actorId: string, method: PaymentMethod): Promise<PaymentMethod>;
}

export type PaymentMethodAdministrationError = Readonly<{
  kind: "payment-method-administration-error";
  code: "INVALID_INPUT" | "OPERATION_FAILED";
}>;

export class PaymentMethodAdministrationService {
  constructor(
    private readonly gateway: PaymentMethodAdministrationGateway,
    private readonly audit: AuditEventService,
    private readonly createId: () => string,
  ) {}

  async list(): Promise<
    Result<readonly PaymentMethod[], PaymentMethodAdministrationError>
  > {
    try {
      return ok(Object.freeze([...(await this.gateway.list())]));
    } catch {
      return failure("OPERATION_FAILED");
    }
  }

  async save(
    actorId: string,
    input: SavePaymentMethodInput,
  ): Promise<Result<PaymentMethod, PaymentMethodAdministrationError>> {
    const normalized = normalize(input, this.createId);
    if (!isUuid(actorId) || normalized === null)
      return failure("INVALID_INPUT");
    try {
      const current = (await this.gateway.list()).find(
        (item) => item.id === normalized.id,
      );
      if (current && current.restaurantId !== normalized.restaurantId)
        return failure("OPERATION_FAILED");
      const desired = Object.freeze({
        ...normalized,
        restaurantName: current?.restaurantName ?? "",
      });
      const audit = await this.audit.record({
        actorId,
        action: current
          ? current.isActive !== desired.isActive
            ? desired.isActive
              ? "payment_method.activated"
              : "payment_method.deactivated"
            : "payment_method.updated"
          : "payment_method.created",
        entityType: "payment_method",
        entityId: desired.id,
        previousValues: current ? snapshot(current) : null,
        newValues: snapshot(desired),
      });
      if (!audit.ok) return failure("OPERATION_FAILED");
      return ok(await this.gateway.save(actorId, desired));
    } catch {
      return failure("OPERATION_FAILED");
    }
  }
}

function normalize(input: SavePaymentMethodInput, createId: () => string) {
  const id = input.id?.trim() || createId();
  const code = input.code.trim().toLowerCase();
  const name = compact(input.name);
  const displayOrder = /^\d{1,6}$/.test(input.displayOrder)
    ? Number(input.displayOrder)
    : -1;
  const bankName = compact(input.bankName);
  const accountHolder = compact(input.accountHolder);
  const accountNumber = compact(input.accountNumber);
  const receiptHeader = input.receiptHeader.trim();
  const receiptFooter = input.receiptFooter.trim();
  if (
    !isUuid(id) ||
    !isUuid(input.restaurantId) ||
    !/^[a-z][a-z0-9_]{0,49}$/.test(code) ||
    name.length < 1 ||
    name.length > 120 ||
    displayOrder < 0 ||
    displayOrder > 100000 ||
    bankName.length > 120 ||
    accountHolder.length > 120 ||
    accountNumber.length > 80 ||
    receiptHeader.length > 500 ||
    receiptFooter.length > 500 ||
    (!input.isBankTransfer && (bankName || accountHolder || accountNumber))
  )
    return null;
  return Object.freeze({
    id,
    restaurantId: input.restaurantId,
    code,
    name,
    displayOrder,
    isActive: input.isActive,
    isBankTransfer: input.isBankTransfer,
    bankName,
    accountHolder,
    accountNumber,
    receiptHeader,
    receiptFooter,
  });
}

function snapshot(method: PaymentMethod) {
  return {
    restaurantId: method.restaurantId,
    code: method.code,
    name: method.name,
    displayOrder: method.displayOrder,
    isActive: method.isActive,
    isBankTransfer: method.isBankTransfer,
    bankName: method.bankName,
    accountHolder: method.accountHolder,
    accountNumber: method.accountNumber,
    receiptHeader: method.receiptHeader,
    receiptFooter: method.receiptFooter,
  };
}
function compact(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
function failure(code: PaymentMethodAdministrationError["code"]) {
  return err(
    Object.freeze({
      kind: "payment-method-administration-error" as const,
      code,
    }),
  );
}
function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
