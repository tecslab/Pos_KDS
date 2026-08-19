export type PrintDocumentType = "KITCHEN_TICKET" | "PAYMENT_RECEIPT";

export type PrintLineAlignment = "LEFT" | "CENTER" | "RIGHT";

export type PrintLine = Readonly<{
  text: string;
  emphasized?: boolean;
  alignment?: PrintLineAlignment;
}>;

export type PrintDocument = Readonly<{
  id: string;
  type: PrintDocumentType;
  lines: readonly PrintLine[];
}>;

export type PrintRequest = Readonly<{
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  restaurantId: string;
  logicalTarget: string;
  document: PrintDocument;
}>;

export type PrinterDestination = Readonly<{
  id: string;
}>;

export type PrinterSelectionOutcome =
  | Readonly<{
      status: "selected";
      destination: PrinterDestination;
    }>
  | Readonly<{
      status: "skipped";
      reason: "PRINTING_DISABLED" | "NO_PRINTER_CONFIGURED";
    }>;

export interface PrinterSelector {
  select(request: PrintRequest): Promise<PrinterSelectionOutcome>;
}

export type SanitizedPrintFailure = Readonly<{
  code:
    | "INVALID_PRINT_REQUEST"
    | "PRINTER_SELECTION_FAILED"
    | "PRINTER_UNAVAILABLE"
    | "PRINT_FAILED"
    | "PRINTER_SERVICE_FAILED";
  retryable: boolean;
}>;

export type PrinterExecutionOutcome =
  | Readonly<{
      status: "printed";
      providerReference?: string | null;
    }>
  | Readonly<{
      status: "skipped";
      reason: "ADAPTER_NOOP";
    }>
  | Readonly<{
      status: "failed";
      failure: SanitizedPrintFailure;
    }>;

export interface PrinterService {
  print(
    destination: PrinterDestination,
    request: PrintRequest,
  ): Promise<PrinterExecutionOutcome>;
}

export type PrintRetryDecision =
  | Readonly<{ action: "STOP" }>
  | Readonly<{
      action: "RETRY";
      nextAttemptNumber: number;
    }>;

export interface PrintRetryAdvisor {
  decide(
    request: PrintRequest,
    failure: SanitizedPrintFailure,
  ): Promise<PrintRetryDecision>;
}

export type PrintFailureReport = Readonly<{
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  restaurantId: string;
  logicalTarget: string;
  documentId: string;
  documentType: PrintDocumentType;
  destinationId: string | null;
  failure: SanitizedPrintFailure;
  retry: PrintRetryDecision;
}>;

export interface PrintErrorReporter {
  report(failure: PrintFailureReport): Promise<void>;
}

type PrintOutcomeMetadata = Readonly<{
  jobId: string;
  attemptId: string;
}>;

export type PrintOutcome =
  | (PrintOutcomeMetadata &
      Readonly<{
        status: "printed";
        providerReference: string | null;
      }>)
  | (PrintOutcomeMetadata &
      Readonly<{
        status: "skipped";
        reason: "PRINTING_DISABLED" | "NO_PRINTER_CONFIGURED" | "ADAPTER_NOOP";
      }>)
  | (PrintOutcomeMetadata &
      Readonly<{
        status: "failed";
        failure: SanitizedPrintFailure;
        retry: PrintRetryDecision;
      }>);
