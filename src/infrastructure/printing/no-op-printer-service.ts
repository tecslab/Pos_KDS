import type {
  PrintDocumentType,
  PrinterDestination,
  PrinterExecutionOutcome,
  PrinterService,
  PrintRequest,
} from "../../application";

export type NoOpPrintMetadata = Readonly<{
  event: "print.skipped";
  reason: "ADAPTER_NOOP";
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  restaurantId: string;
  logicalTarget: string;
  destinationId: string;
  documentId: string;
  documentType: PrintDocumentType;
  lineCount: number;
}>;

export interface PrintMetadataLogger {
  log(metadata: NoOpPrintMetadata): void | Promise<void>;
}

const skippedOutcome: PrinterExecutionOutcome = Object.freeze({
  status: "skipped",
  reason: "ADAPTER_NOOP",
});

/** Safe local adapter that records metadata only and never emits document text. */
export class NoOpPrinterService implements PrinterService {
  constructor(private readonly logger: PrintMetadataLogger) {}

  async print(
    destination: PrinterDestination,
    request: PrintRequest,
  ): Promise<PrinterExecutionOutcome> {
    try {
      const metadata: NoOpPrintMetadata = Object.freeze({
        event: "print.skipped",
        reason: "ADAPTER_NOOP",
        jobId: request.jobId,
        attemptId: request.attemptId,
        attemptNumber: request.attemptNumber,
        restaurantId: request.restaurantId,
        logicalTarget: request.logicalTarget,
        destinationId: destination.id,
        documentId: request.document.id,
        documentType: request.document.type,
        lineCount: request.document.lines.length,
      });
      await this.logger.log(metadata);
    } catch {
      // A local logging failure cannot affect already-persisted business work.
    }

    return skippedOutcome;
  }
}
