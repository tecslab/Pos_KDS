import type {
  PrintDocument,
  PrintErrorReporter,
  PrintFailureReport,
  PrintLine,
  PrintOutcome,
  PrintRequest,
  PrintRetryAdvisor,
  PrintRetryDecision,
  PrinterDestination,
  PrinterExecutionOutcome,
  PrinterSelectionOutcome,
  PrinterSelector,
  PrinterService,
  SanitizedPrintFailure,
} from "./printing";

const stopRetry: PrintRetryDecision = Object.freeze({ action: "STOP" });

const selectionFailure: SanitizedPrintFailure = Object.freeze({
  code: "PRINTER_SELECTION_FAILED",
  retryable: true,
});

const serviceFailure: SanitizedPrintFailure = Object.freeze({
  code: "PRINTER_SERVICE_FAILED",
  retryable: true,
});

const invalidRequestFailure: SanitizedPrintFailure = Object.freeze({
  code: "INVALID_PRINT_REQUEST",
  retryable: false,
});

/**
 * Best-effort printing boundary. Callers must invoke this only after the
 * corresponding business transaction has committed. Every dependency failure
 * is converted to a sanitized outcome, so this method never rejects.
 */
export class PrintingFacade {
  constructor(
    private readonly selector: PrinterSelector,
    private readonly printer: PrinterService,
    private readonly retryAdvisor: PrintRetryAdvisor,
    private readonly errorReporter: PrintErrorReporter,
  ) {}

  async printAfterPersistence(request: PrintRequest): Promise<PrintOutcome> {
    try {
      const safeRequest = normalizeRequest(request);

      if (safeRequest === null) {
        return await this.failureOutcome(request, null, invalidRequestFailure);
      }

      let selection: PrinterSelectionOutcome;

      try {
        selection = await this.selector.select(safeRequest);
      } catch {
        return await this.failureOutcome(safeRequest, null, selectionFailure);
      }

      const safeSelection = normalizeSelection(selection);

      if (safeSelection === null) {
        return await this.failureOutcome(safeRequest, null, selectionFailure);
      }

      if (safeSelection.status === "skipped") {
        return Object.freeze({
          status: "skipped",
          jobId: safeRequest.jobId,
          attemptId: safeRequest.attemptId,
          reason: safeSelection.reason,
        });
      }

      let execution: PrinterExecutionOutcome;

      try {
        execution = await this.printer.print(
          safeSelection.destination,
          safeRequest,
        );
      } catch {
        return await this.failureOutcome(
          safeRequest,
          safeSelection.destination,
          serviceFailure,
        );
      }

      const safeExecution = normalizeExecution(execution);

      if (safeExecution === null) {
        return await this.failureOutcome(safeRequest, null, serviceFailure);
      }

      if (safeExecution.status === "printed") {
        return Object.freeze({
          status: "printed",
          jobId: safeRequest.jobId,
          attemptId: safeRequest.attemptId,
          providerReference: safeExecution.providerReference,
        });
      }

      if (safeExecution.status === "skipped") {
        return Object.freeze({
          status: "skipped",
          jobId: safeRequest.jobId,
          attemptId: safeRequest.attemptId,
          reason: safeExecution.reason,
        });
      }

      return await this.failureOutcome(
        safeRequest,
        safeSelection.destination,
        safeExecution.failure,
      );
    } catch {
      return this.fallbackFailureOutcome(request);
    }
  }

  private async failureOutcome(
    request: PrintRequest,
    destination: PrinterDestination | null,
    failure: SanitizedPrintFailure,
  ): Promise<PrintOutcome> {
    const safeRequest = normalizeRequest(request);

    if (safeRequest === null) {
      return this.fallbackFailureOutcome(request);
    }

    let retry = stopRetry;

    if (failure.retryable) {
      try {
        retry = normalizeRetryDecision(
          await this.retryAdvisor.decide(safeRequest, failure),
          safeRequest.attemptNumber,
        );
      } catch {
        retry = stopRetry;
      }
    }

    const report: PrintFailureReport = Object.freeze({
      jobId: safeRequest.jobId,
      attemptId: safeRequest.attemptId,
      attemptNumber: safeRequest.attemptNumber,
      restaurantId: safeRequest.restaurantId,
      logicalTarget: safeRequest.logicalTarget,
      documentId: safeRequest.document.id,
      documentType: safeRequest.document.type,
      destinationId: destination?.id ?? null,
      failure,
      retry,
    });

    try {
      await this.errorReporter.report(report);
    } catch {
      // Error reporting is best effort and cannot compromise persisted work.
    }

    return Object.freeze({
      status: "failed",
      jobId: safeRequest.jobId,
      attemptId: safeRequest.attemptId,
      failure,
      retry,
    });
  }

  private fallbackFailureOutcome(request: PrintRequest): PrintOutcome {
    return Object.freeze({
      status: "failed",
      jobId: safeIdentifier(readProperty(request, "jobId")),
      attemptId: safeIdentifier(readProperty(request, "attemptId")),
      failure: invalidRequestFailure,
      retry: stopRetry,
    });
  }
}

function normalizeRequest(request: PrintRequest): PrintRequest | null {
  if (typeof request !== "object" || request === null) {
    return null;
  }

  const jobId = request.jobId;
  const attemptId = request.attemptId;
  const restaurantId = request.restaurantId;
  const logicalTarget = request.logicalTarget;
  const attemptNumber = request.attemptNumber;
  const document = normalizeDocument(request.document);

  if (
    !isNonblank(jobId) ||
    !isNonblank(attemptId) ||
    !isNonblank(restaurantId) ||
    !isNonblank(logicalTarget) ||
    !Number.isSafeInteger(attemptNumber) ||
    attemptNumber < 1 ||
    document === null
  ) {
    return null;
  }

  return Object.freeze({
    jobId,
    attemptId,
    attemptNumber,
    restaurantId,
    logicalTarget,
    document,
  });
}

function normalizeDocument(document: PrintDocument): PrintDocument | null {
  if (
    typeof document !== "object" ||
    document === null ||
    !isNonblank(document.id) ||
    (document.type !== "KITCHEN_TICKET" &&
      document.type !== "PAYMENT_RECEIPT") ||
    !Array.isArray(document.lines) ||
    document.lines.length === 0
  ) {
    return null;
  }

  const lines: PrintLine[] = [];

  for (const line of document.lines) {
    const normalized = normalizeLine(line);

    if (normalized === null) {
      return null;
    }

    lines.push(normalized);
  }

  return Object.freeze({
    id: document.id,
    type: document.type,
    lines: Object.freeze(lines),
  });
}

function normalizeLine(line: PrintLine): PrintLine | null {
  if (
    typeof line !== "object" ||
    line === null ||
    typeof line.text !== "string" ||
    (line.emphasized !== undefined && typeof line.emphasized !== "boolean") ||
    (line.alignment !== undefined &&
      line.alignment !== "LEFT" &&
      line.alignment !== "CENTER" &&
      line.alignment !== "RIGHT")
  ) {
    return null;
  }

  return Object.freeze({
    text: line.text,
    ...(line.emphasized === undefined ? {} : { emphasized: line.emphasized }),
    ...(line.alignment === undefined ? {} : { alignment: line.alignment }),
  });
}

function normalizeSelection(
  selection: PrinterSelectionOutcome,
): PrinterSelectionOutcome | null {
  if (typeof selection !== "object" || selection === null) {
    return null;
  }

  if (
    selection.status === "skipped" &&
    (selection.reason === "PRINTING_DISABLED" ||
      selection.reason === "NO_PRINTER_CONFIGURED")
  ) {
    return Object.freeze({ status: "skipped", reason: selection.reason });
  }

  if (
    selection.status === "selected" &&
    typeof selection.destination === "object" &&
    selection.destination !== null &&
    isNonblank(selection.destination.id)
  ) {
    return Object.freeze({
      status: "selected",
      destination: Object.freeze({ id: selection.destination.id }),
    });
  }

  return null;
}

function normalizeExecution(
  execution: PrinterExecutionOutcome,
):
  | Readonly<{ status: "printed"; providerReference: string | null }>
  | Readonly<{ status: "skipped"; reason: "ADAPTER_NOOP" }>
  | Readonly<{ status: "failed"; failure: SanitizedPrintFailure }>
  | null {
  if (typeof execution !== "object" || execution === null) {
    return null;
  }

  if (execution.status === "printed") {
    if (
      execution.providerReference !== undefined &&
      execution.providerReference !== null &&
      !isNonblank(execution.providerReference)
    ) {
      return null;
    }

    return Object.freeze({
      status: "printed",
      providerReference: execution.providerReference ?? null,
    });
  }

  if (execution.status === "skipped" && execution.reason === "ADAPTER_NOOP") {
    return Object.freeze({ status: "skipped", reason: "ADAPTER_NOOP" });
  }

  if (execution.status === "failed") {
    const failure = normalizeFailure(execution.failure);
    return failure === null
      ? null
      : Object.freeze({ status: "failed", failure });
  }

  return null;
}

function normalizeFailure(
  failure: SanitizedPrintFailure,
): SanitizedPrintFailure | null {
  if (typeof failure !== "object" || failure === null) {
    return null;
  }

  const codes: readonly SanitizedPrintFailure["code"][] = [
    "INVALID_PRINT_REQUEST",
    "PRINTER_SELECTION_FAILED",
    "PRINTER_UNAVAILABLE",
    "PRINT_FAILED",
    "PRINTER_SERVICE_FAILED",
  ];

  return codes.includes(failure.code) && typeof failure.retryable === "boolean"
    ? Object.freeze({ code: failure.code, retryable: failure.retryable })
    : null;
}

function normalizeRetryDecision(
  retry: PrintRetryDecision,
  currentAttemptNumber: number,
): PrintRetryDecision {
  if (
    typeof retry === "object" &&
    retry !== null &&
    retry.action === "RETRY" &&
    Number.isSafeInteger(retry.nextAttemptNumber) &&
    retry.nextAttemptNumber > currentAttemptNumber
  ) {
    return Object.freeze({
      action: "RETRY",
      nextAttemptNumber: retry.nextAttemptNumber,
    });
  }

  return stopRetry;
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readProperty(value: unknown, key: string): unknown {
  try {
    return typeof value === "object" && value !== null
      ? Reflect.get(value, key)
      : undefined;
  } catch {
    return undefined;
  }
}

function safeIdentifier(value: unknown): string {
  return isNonblank(value) ? value : "unknown";
}
