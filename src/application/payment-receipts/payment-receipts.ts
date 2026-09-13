import type { RegisteredPayment } from "../payment-registration";
import {
  NoOpOperationalTelemetryRecorder,
  type OperationalTelemetryRecorder,
} from "../observability";
import {
  AuthorizationService,
  type AuthorizationProfileReader,
} from "../authorization";
import { PrintingFacade } from "../printing/printing-facade";
import type {
  PrintDocument,
  PrintErrorReporter,
  PrintOutcome,
  PrintRequest,
  PrintRetryAdvisor,
  PrinterSelectionOutcome,
  PrinterSelector,
  PrinterService,
} from "../printing/printing";

const RECEIPT_PERMISSION = "payments.receipt.print";
const RECEIPT_TARGET = "receipt:default";

export type PaymentReceiptLine = Readonly<{
  id: string;
  productName: string;
  quantity: number;
  finalUnitPrice: string;
  lineTotal: string;
  selectedOptions: readonly string[];
  removedIngredients: readonly string[];
  observations: string | null;
}>;

export type PaymentReceiptPrinterConfiguration = Readonly<{
  enabled: boolean;
  destinationId: string | null;
}>;

export type PaymentReceiptSnapshot = Readonly<{
  restaurantId: string;
  restaurantName: string;
  orderId: string;
  orderNumber: string;
  basketId: string;
  basketTotalAmount: string;
  receiptHeader: string | null;
  receiptFooter: string | null;
  printer: PaymentReceiptPrinterConfiguration;
  lines: readonly PaymentReceiptLine[];
}>;

export type PaymentReceiptSnapshotRequest = Readonly<{
  restaurantId: string;
  orderId: string;
  basketId: string;
  paymentMethodId: string;
}>;

export interface PaymentReceiptSnapshotReader {
  read(
    request: PaymentReceiptSnapshotRequest,
  ): Promise<PaymentReceiptSnapshot | null>;
}

type ReceiptOutcomeMetadata = Readonly<{
  jobId: string;
  attemptId: string | null;
}>;

export type PaymentReceiptDispatchOutcome =
  | PrintOutcome
  | (ReceiptOutcomeMetadata &
      Readonly<{ status: "skipped"; reason: "NOT_AUTHORIZED" }>)
  | (ReceiptOutcomeMetadata &
      Readonly<{
        status: "failed";
        failure: Readonly<{
          code: "RECEIPT_PREPARATION_FAILED";
          retryable: false;
        }>;
        retry: Readonly<{ action: "STOP" }>;
      }>);

const preparationFailure = Object.freeze({
  code: "RECEIPT_PREPARATION_FAILED" as const,
  retryable: false as const,
});
const stopRetry = Object.freeze({ action: "STOP" as const });

export class PaymentReceiptService {
  constructor(
    private readonly profiles: AuthorizationProfileReader,
    private readonly snapshots: PaymentReceiptSnapshotReader,
    private readonly printer: PrinterService,
    private readonly retryAdvisor: PrintRetryAdvisor,
    private readonly errorReporter: PrintErrorReporter,
    private readonly createAttemptId: () => string,
    private readonly telemetry: OperationalTelemetryRecorder = new NoOpOperationalTelemetryRecorder(),
  ) {}

  async dispatch(
    authenticatedUserId: string,
    payment: RegisteredPayment,
  ): Promise<PaymentReceiptDispatchOutcome> {
    const jobId = receiptId(payment?.paymentId);
    const authorization = await new AuthorizationService(
      this.profiles,
    ).authorize(authenticatedUserId, RECEIPT_PERMISSION);

    if (!authorization.ok) {
      return Object.freeze({
        status: "skipped" as const,
        jobId,
        attemptId: null,
        reason: "NOT_AUTHORIZED" as const,
      });
    }

    try {
      const paymentSnapshot = normalizePayment(payment);
      if (paymentSnapshot === null)
        return paymentReceiptPreparationFailure(jobId);

      const snapshot = normalizeSnapshot(
        await this.snapshots.read(
          Object.freeze({
            restaurantId: paymentSnapshot.restaurantId,
            orderId: paymentSnapshot.orderId,
            basketId: paymentSnapshot.basketId,
            paymentMethodId: paymentSnapshot.paymentMethodId,
          }),
        ),
        paymentSnapshot,
      );
      if (snapshot === null) return paymentReceiptPreparationFailure(jobId);

      const attemptId = this.createAttemptId();
      if (!isNonblank(attemptId))
        return paymentReceiptPreparationFailure(jobId);

      const request: PrintRequest = Object.freeze({
        jobId,
        attemptId,
        attemptNumber: 1,
        restaurantId: paymentSnapshot.restaurantId,
        logicalTarget: RECEIPT_TARGET,
        document: formatPaymentReceipt(paymentSnapshot, snapshot),
      });

      return await new PrintingFacade(
        new ConfiguredPaymentReceiptPrinterSelector(snapshot.printer),
        this.printer,
        this.retryAdvisor,
        this.errorReporter,
        this.telemetry,
      ).printAfterPersistence(request);
    } catch {
      return paymentReceiptPreparationFailure(jobId);
    }
  }
}

export class ConfiguredPaymentReceiptPrinterSelector implements PrinterSelector {
  constructor(
    private readonly configuration: PaymentReceiptPrinterConfiguration,
  ) {}

  async select(): Promise<PrinterSelectionOutcome> {
    if (!this.configuration.enabled) {
      return Object.freeze({
        status: "skipped" as const,
        reason: "PRINTING_DISABLED" as const,
      });
    }
    if (!isNonblank(this.configuration.destinationId)) {
      return Object.freeze({
        status: "skipped" as const,
        reason: "NO_PRINTER_CONFIGURED" as const,
      });
    }
    return Object.freeze({
      status: "selected" as const,
      destination: Object.freeze({ id: this.configuration.destinationId }),
    });
  }
}

export function formatPaymentReceipt(
  payment: RegisteredPayment,
  snapshot: PaymentReceiptSnapshot,
): PrintDocument {
  const lines = [
    ...configuredLines(snapshot.receiptHeader),
    Object.freeze({
      text: snapshot.restaurantName,
      emphasized: true,
      alignment: "CENTER" as const,
    }),
    Object.freeze({
      text: "RECIBO DE PAGO",
      emphasized: true,
      alignment: "CENTER" as const,
    }),
    Object.freeze({ text: `Orden ${snapshot.orderNumber}` }),
    ...snapshot.lines.flatMap((line) => [
      Object.freeze({
        text: `${line.quantity} × ${line.productName}  $${line.lineTotal}`,
      }),
      ...line.selectedOptions.map((name) =>
        Object.freeze({ text: `+ ${name}` }),
      ),
      ...line.removedIngredients.map((name) =>
        Object.freeze({ text: `Sin ${name}` }),
      ),
      ...(line.observations === null
        ? []
        : [Object.freeze({ text: line.observations })]),
    ]),
    Object.freeze({ text: `Total canasta: $${payment.basketTotalAmount}` }),
    Object.freeze({
      text: `Pago (${payment.paymentMethodName}): $${payment.amount}`,
      emphasized: true,
    }),
    Object.freeze({ text: `Pagado: $${payment.basketPaidAmount}` }),
    Object.freeze({ text: `Saldo: $${payment.basketOutstandingBalance}` }),
    Object.freeze({ text: `Fecha: ${payment.recordedAt}` }),
    ...(payment.referenceNumber === null
      ? []
      : [Object.freeze({ text: `Referencia: ${payment.referenceNumber}` })]),
    ...(payment.comments === null
      ? []
      : [Object.freeze({ text: `Comentario: ${payment.comments}` })]),
    ...configuredLines(snapshot.receiptFooter),
  ];

  return Object.freeze({
    id: receiptId(payment.paymentId),
    type: "PAYMENT_RECEIPT" as const,
    lines: Object.freeze(lines),
  });
}

function configuredLines(text: string | null) {
  return text === null
    ? []
    : text.split(/\r?\n/).map((value) =>
        Object.freeze({
          text: value,
          alignment: "CENTER" as const,
        }),
      );
}

function normalizePayment(
  payment: RegisteredPayment,
): RegisteredPayment | null {
  if (
    !isRecord(payment) ||
    !isUuid(payment.paymentId) ||
    !isUuid(payment.restaurantId) ||
    !isUuid(payment.orderId) ||
    !isUuid(payment.basketId) ||
    !isUuid(payment.paymentMethodId) ||
    !isUuid(payment.recordedById) ||
    !isMoney(payment.amount, true) ||
    !isNonblank(payment.paymentMethodCode) ||
    !isNonblank(payment.paymentMethodName) ||
    !optionalText(payment.referenceNumber) ||
    !optionalText(payment.comments) ||
    !isTimestamp(payment.recordedAt) ||
    !isMoney(payment.basketTotalAmount, true) ||
    !isMoney(payment.basketPaidAmount, false) ||
    !isMoney(payment.basketOutstandingBalance, false)
  ) {
    return null;
  }
  return payment;
}

function normalizeSnapshot(
  snapshot: PaymentReceiptSnapshot | null,
  payment: RegisteredPayment,
): PaymentReceiptSnapshot | null {
  if (
    !isRecord(snapshot) ||
    snapshot.restaurantId !== payment.restaurantId ||
    snapshot.orderId !== payment.orderId ||
    snapshot.basketId !== payment.basketId ||
    snapshot.basketTotalAmount !== payment.basketTotalAmount ||
    !isNonblank(snapshot.restaurantName) ||
    !isNonblank(snapshot.orderNumber) ||
    !optionalConfiguredText(snapshot.receiptHeader) ||
    !optionalConfiguredText(snapshot.receiptFooter) ||
    !isRecord(snapshot.printer) ||
    typeof snapshot.printer.enabled !== "boolean" ||
    !(
      snapshot.printer.destinationId === null ||
      isNonblank(snapshot.printer.destinationId)
    ) ||
    !Array.isArray(snapshot.lines) ||
    snapshot.lines.length === 0
  ) {
    return null;
  }
  return snapshot;
}

function optionalText(value: unknown) {
  return value === null || typeof value === "string";
}

function optionalConfiguredText(value: unknown) {
  return value === null || (typeof value === "string" && value.length <= 500);
}

function isMoney(value: unknown, positive: boolean) {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) return false;
  const amount = BigInt(value.replace(".", ""));
  return positive ? amount > BigInt(0) : amount >= BigInt(0);
}

function isTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function receiptId(paymentId: unknown) {
  return `payment-receipt:${isUuid(paymentId) ? paymentId : "unknown"}`;
}

export function paymentReceiptPreparationFailure(
  jobOrPaymentId: string,
): PaymentReceiptDispatchOutcome {
  const jobId = jobOrPaymentId.startsWith("payment-receipt:")
    ? jobOrPaymentId
    : receiptId(jobOrPaymentId);
  return Object.freeze({
    status: "failed" as const,
    jobId,
    attemptId: null,
    failure: preparationFailure,
    retry: stopRetry,
  });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
