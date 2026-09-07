import { describe, expect, it, vi } from "vitest";

import type { RegisteredPayment } from "../payment-registration";
import type {
  PrintErrorReporter,
  PrintRetryAdvisor,
  PrinterService,
} from "../printing";
import {
  ConfiguredPaymentReceiptPrinterSelector,
  PaymentReceiptService,
  formatPaymentReceipt,
  type PaymentReceiptSnapshot,
} from "./payment-receipts";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const methodId = "43000000-0000-4000-8000-000000000001";
const paymentId = "44000000-0000-4000-8000-000000000001";

const payment: RegisteredPayment = Object.freeze({
  paymentId,
  restaurantId,
  orderId,
  basketId,
  paymentMethodId: methodId,
  recordedById: actorId,
  amount: "6.00",
  paymentMethodCode: "old_cash",
  paymentMethodName: "Historical Cash Label",
  referenceNumber: "REF-7",
  comments: "First payment",
  recordedAt: "2026-09-05T10:00:00.000Z",
  overageAuthorizedById: null,
  overageAuthorizedAt: null,
  overageReason: null,
  basketTotalAmount: "10.00",
  basketPaidAmount: "6.00",
  basketOutstandingBalance: "4.00",
  basketPreviousStatus: "PENDING",
  basketStatus: "PENDING",
  orderPreviousStatus: "DELIVERED",
  orderStatus: "DELIVERED",
  orderPaidAt: null,
});

const snapshot: PaymentReceiptSnapshot = Object.freeze({
  restaurantId,
  restaurantName: "Carnales",
  orderId,
  orderNumber: "ORD-42",
  basketId,
  basketTotalAmount: "10.00",
  receiptHeader: "CABECERA CONFIGURADA\nSucursal Centro",
  receiptFooter: "PIE CONFIGURADO",
  printer: Object.freeze({ enabled: true, destinationId: "receipt-printer-1" }),
  lines: Object.freeze([
    Object.freeze({
      id: "45000000-0000-4000-8000-000000000001",
      productName: "Historical Taco",
      quantity: 2,
      finalUnitPrice: "5.00",
      lineTotal: "10.00",
      selectedOptions: Object.freeze(["Queso"]),
      removedIngredients: Object.freeze(["Cebolla"]),
      observations: "Bien cocido",
    }),
  ]),
});

function setup(permissions: readonly string[] = ["payments.receipt.print"]) {
  const reader = { read: vi.fn().mockResolvedValue(snapshot) };
  const print = vi.fn<PrinterService["print"]>().mockResolvedValue({
    status: "printed",
    providerReference: "provider-1",
  });
  const decide = vi.fn<PrintRetryAdvisor["decide"]>().mockResolvedValue({
    action: "RETRY",
    nextAttemptNumber: 2,
  });
  const report = vi
    .fn<PrintErrorReporter["report"]>()
    .mockResolvedValue(undefined);
  return {
    decide,
    print,
    reader,
    report,
    service: new PaymentReceiptService(
      {
        findByAuthenticatedUserId: vi.fn().mockResolvedValue({
          userId: actorId,
          displayName: "Ana",
          isActive: true,
          roleGrants: [
            { roleCode: "custom-cashier", permissionCodes: permissions },
          ],
        }),
      },
      reader,
      { print },
      { decide },
      { report },
      () => "attempt-1",
    ),
  };
}

describe("payment receipt formatting", () => {
  it("formats configured text and immutable sale/payment labels into a frozen document", () => {
    const document = formatPaymentReceipt(payment, snapshot);

    expect(document).toMatchObject({
      id: `payment-receipt:${paymentId}`,
      type: "PAYMENT_RECEIPT",
    });
    expect(document.lines.map((line) => line.text)).toEqual([
      "CABECERA CONFIGURADA",
      "Sucursal Centro",
      "Carnales",
      "RECIBO DE PAGO",
      "Orden ORD-42",
      "2 × Historical Taco  $10.00",
      "+ Queso",
      "Sin Cebolla",
      "Bien cocido",
      "Total canasta: $10.00",
      "Pago (Historical Cash Label): $6.00",
      "Pagado: $6.00",
      "Saldo: $4.00",
      "Fecha: 2026-09-05T10:00:00.000Z",
      "Referencia: REF-7",
      "Comentario: First payment",
      "PIE CONFIGURADO",
    ]);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.lines)).toBe(true);
    expect(Object.isFrozen(document.lines[0])).toBe(true);
  });
});

describe("ConfiguredPaymentReceiptPrinterSelector", () => {
  it.each([
    [false, null, "PRINTING_DISABLED"],
    [true, null, "NO_PRINTER_CONFIGURED"],
  ] as const)(
    "maps configured selection without exposing raw JSON",
    async (enabled, destinationId, reason) => {
      await expect(
        new ConfiguredPaymentReceiptPrinterSelector({
          enabled,
          destinationId,
        }).select(),
      ).resolves.toEqual({ status: "skipped", reason });
    },
  );
});

describe("PaymentReceiptService", () => {
  it("authorizes by permission and dispatches the deterministic receipt after reading persisted snapshots", async () => {
    const fixture = setup();

    await expect(fixture.service.dispatch(actorId, payment)).resolves.toEqual({
      status: "printed",
      jobId: `payment-receipt:${paymentId}`,
      attemptId: "attempt-1",
      providerReference: "provider-1",
    });
    expect(fixture.reader.read).toHaveBeenCalledWith({
      restaurantId,
      orderId,
      basketId,
      paymentMethodId: methodId,
    });
    expect(fixture.print).toHaveBeenCalledWith(
      { id: "receipt-printer-1" },
      expect.objectContaining({
        jobId: `payment-receipt:${paymentId}`,
        attemptNumber: 1,
        logicalTarget: "receipt:default",
      }),
    );
  });

  it("skips an unpermitted actor without reading or printing", async () => {
    const fixture = setup([]);

    await expect(fixture.service.dispatch(actorId, payment)).resolves.toEqual({
      status: "skipped",
      jobId: `payment-receipt:${paymentId}`,
      attemptId: null,
      reason: "NOT_AUTHORIZED",
    });
    expect(fixture.reader.read).not.toHaveBeenCalled();
    expect(fixture.print).not.toHaveBeenCalled();
  });

  it.each([
    [{ enabled: false, destinationId: null }, "PRINTING_DISABLED"],
    [{ enabled: true, destinationId: null }, "NO_PRINTER_CONFIGURED"],
  ] as const)("reports configured skip %s", async (printer, reason) => {
    const fixture = setup();
    fixture.reader.read.mockResolvedValue({ ...snapshot, printer });

    await expect(fixture.service.dispatch(actorId, payment)).resolves.toEqual({
      status: "skipped",
      jobId: `payment-receipt:${paymentId}`,
      attemptId: "attempt-1",
      reason,
    });
    expect(fixture.print).not.toHaveBeenCalled();
  });

  it("returns sanitized retry advice when the printer fails", async () => {
    const fixture = setup();
    fixture.print.mockResolvedValue({
      status: "failed",
      failure: { code: "PRINTER_UNAVAILABLE", retryable: true },
    });

    await expect(fixture.service.dispatch(actorId, payment)).resolves.toEqual({
      status: "failed",
      jobId: `payment-receipt:${paymentId}`,
      attemptId: "attempt-1",
      failure: { code: "PRINTER_UNAVAILABLE", retryable: true },
      retry: { action: "RETRY", nextAttemptNumber: 2 },
    });
    expect(fixture.report).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: `payment-receipt:${paymentId}`,
        documentType: "PAYMENT_RECEIPT",
      }),
    );
    expect(JSON.stringify(fixture.report.mock.calls[0]?.[0])).not.toContain(
      "Historical Taco",
    );
  });

  it("reports the default adapter no-op as a non-error skip", async () => {
    const fixture = setup();
    fixture.print.mockResolvedValue({
      status: "skipped",
      reason: "ADAPTER_NOOP",
    });

    await expect(fixture.service.dispatch(actorId, payment)).resolves.toEqual({
      status: "skipped",
      jobId: `payment-receipt:${paymentId}`,
      attemptId: "attempt-1",
      reason: "ADAPTER_NOOP",
    });
    expect(fixture.decide).not.toHaveBeenCalled();
    expect(fixture.report).not.toHaveBeenCalled();
  });

  it("sanitizes snapshot and preparation failures without invoking the printer", async () => {
    const fixture = setup();
    fixture.reader.read.mockRejectedValue(new Error("database secret"));

    await expect(fixture.service.dispatch(actorId, payment)).resolves.toEqual({
      status: "failed",
      jobId: `payment-receipt:${paymentId}`,
      attemptId: null,
      failure: { code: "RECEIPT_PREPARATION_FAILED", retryable: false },
      retry: { action: "STOP" },
    });
    expect(fixture.print).not.toHaveBeenCalled();
  });
});
