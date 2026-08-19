import { describe, expect, it, vi } from "vitest";

import type { PrintRequest } from "../../application";

import {
  NoOpPrinterService,
  type PrintMetadataLogger,
} from "./no-op-printer-service";

const sensitiveText = "Card reference and customer content must stay private";

const request: PrintRequest = {
  jobId: "job-1",
  attemptId: "attempt-1",
  attemptNumber: 1,
  restaurantId: "restaurant-1",
  logicalTarget: "receipt:front-desk",
  document: {
    id: "receipt-9",
    type: "PAYMENT_RECEIPT",
    lines: [{ text: sensitiveText }],
  },
};

describe("NoOpPrinterService", () => {
  it("logs immutable metadata only and returns an adapter-noop skip", async () => {
    const log = vi.fn<PrintMetadataLogger["log"]>();
    const adapter = new NoOpPrinterService({ log });

    const result = await adapter.print({ id: "printer-logical-1" }, request);

    expect(result).toEqual({ status: "skipped", reason: "ADAPTER_NOOP" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(log).toHaveBeenCalledWith({
      event: "print.skipped",
      reason: "ADAPTER_NOOP",
      jobId: "job-1",
      attemptId: "attempt-1",
      attemptNumber: 1,
      restaurantId: "restaurant-1",
      logicalTarget: "receipt:front-desk",
      destinationId: "printer-logical-1",
      documentId: "receipt-9",
      documentType: "PAYMENT_RECEIPT",
      lineCount: 1,
    });
    const metadata = log.mock.calls[0]?.[0];
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(JSON.stringify(metadata)).not.toContain(sensitiveText);
    expect(metadata).not.toHaveProperty("lines");
    expect(metadata).not.toHaveProperty("text");
  });

  it("never rejects when metadata logging throws or rejects", async () => {
    const throwing = new NoOpPrinterService({
      log() {
        throw new Error("logger unavailable");
      },
    });
    const rejecting = new NoOpPrinterService({
      async log() {
        throw new Error("async logger unavailable");
      },
    });

    await expect(throwing.print({ id: "printer-1" }, request)).resolves.toEqual(
      { status: "skipped", reason: "ADAPTER_NOOP" },
    );
    await expect(
      rejecting.print({ id: "printer-1" }, request),
    ).resolves.toEqual({ status: "skipped", reason: "ADAPTER_NOOP" });
  });

  it("still never rejects if malformed input metadata cannot be read", async () => {
    const adapter = new NoOpPrinterService({ log: vi.fn() });
    const malformed = Object.defineProperty({}, "jobId", {
      get: () => {
        throw new Error("malformed request");
      },
    });

    await expect(
      adapter.print({ id: "printer-1" }, malformed as unknown as PrintRequest),
    ).resolves.toEqual({ status: "skipped", reason: "ADAPTER_NOOP" });
  });
});
