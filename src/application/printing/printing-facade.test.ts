import { describe, expect, it, vi } from "vitest";

import { PrintingFacade } from "./printing-facade";
import type {
  PrintErrorReporter,
  PrintRequest,
  PrintRetryAdvisor,
  PrinterSelector,
  PrinterService,
} from "./printing";

function request(overrides: Partial<PrintRequest> = {}): PrintRequest {
  return {
    jobId: "print-job-1",
    attemptId: "print-attempt-1",
    attemptNumber: 1,
    restaurantId: "restaurant-1",
    logicalTarget: "kitchen:main",
    document: {
      id: "order-42:revision-3",
      type: "KITCHEN_TICKET",
      lines: [
        { text: "Order 42", emphasized: true, alignment: "CENTER" },
        { text: "2 tacos" },
      ],
    },
    ...overrides,
  };
}

function dependencies() {
  const select = vi.fn<PrinterSelector["select"]>().mockResolvedValue({
    status: "selected",
    destination: { id: "logical-printer-1" },
  });
  const print = vi
    .fn<PrinterService["print"]>()
    .mockResolvedValue({ status: "printed", providerReference: null });
  const decide = vi
    .fn<PrintRetryAdvisor["decide"]>()
    .mockResolvedValue({ action: "STOP" });
  const report = vi
    .fn<PrintErrorReporter["report"]>()
    .mockResolvedValue(undefined);

  return {
    decide,
    facade: new PrintingFacade({ select }, { print }, { decide }, { report }),
    print,
    report,
    select,
  };
}

describe("PrintingFacade", () => {
  it.each(["KITCHEN_TICKET", "PAYMENT_RECEIPT"] as const)(
    "prints a detached, immutable %s after persistence",
    async (type) => {
      const original = request({
        document: {
          id: "document-1",
          type,
          lines: [{ text: "sensitive document text" }],
        },
      });
      const fixture = dependencies();
      fixture.print.mockResolvedValue({
        status: "printed",
        providerReference: "provider-job-9",
      });

      const result = await fixture.facade.printAfterPersistence(original);

      expect(result).toEqual({
        status: "printed",
        jobId: "print-job-1",
        attemptId: "print-attempt-1",
        providerReference: "provider-job-9",
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(fixture.select).toHaveBeenCalledOnce();
      expect(fixture.print).toHaveBeenCalledOnce();
      const safeRequest = fixture.print.mock.calls[0]?.[1];
      expect(safeRequest).not.toBe(original);
      expect(Object.isFrozen(safeRequest)).toBe(true);
      expect(Object.isFrozen(safeRequest?.document)).toBe(true);
      expect(Object.isFrozen(safeRequest?.document.lines)).toBe(true);
      expect(Object.isFrozen(safeRequest?.document.lines[0])).toBe(true);
      expect(fixture.decide).not.toHaveBeenCalled();
      expect(fixture.report).not.toHaveBeenCalled();
    },
  );

  it.each(["PRINTING_DISABLED", "NO_PRINTER_CONFIGURED"] as const)(
    "returns selector skip reason %s without invoking the adapter",
    async (reason) => {
      const fixture = dependencies();
      fixture.select.mockResolvedValue({ status: "skipped", reason });

      await expect(
        fixture.facade.printAfterPersistence(request()),
      ).resolves.toEqual({
        status: "skipped",
        jobId: "print-job-1",
        attemptId: "print-attempt-1",
        reason,
      });
      expect(fixture.print).not.toHaveBeenCalled();
      expect(fixture.decide).not.toHaveBeenCalled();
      expect(fixture.report).not.toHaveBeenCalled();
    },
  );

  it("returns an adapter no-op skip without treating it as an error", async () => {
    const fixture = dependencies();
    fixture.print.mockResolvedValue({
      status: "skipped",
      reason: "ADAPTER_NOOP",
    });

    await expect(
      fixture.facade.printAfterPersistence(request()),
    ).resolves.toEqual({
      status: "skipped",
      jobId: "print-job-1",
      attemptId: "print-attempt-1",
      reason: "ADAPTER_NOOP",
    });
    expect(fixture.report).not.toHaveBeenCalled();
  });

  it("returns and reports a sanitized adapter failure with retry advice", async () => {
    const fixture = dependencies();
    fixture.print.mockResolvedValue({
      status: "failed",
      failure: { code: "PRINTER_UNAVAILABLE", retryable: true },
    });
    fixture.decide.mockResolvedValue({
      action: "RETRY",
      nextAttemptNumber: 2,
    });

    const result = await fixture.facade.printAfterPersistence(request());

    expect(result).toEqual({
      status: "failed",
      jobId: "print-job-1",
      attemptId: "print-attempt-1",
      failure: { code: "PRINTER_UNAVAILABLE", retryable: true },
      retry: { action: "RETRY", nextAttemptNumber: 2 },
    });
    expect(fixture.report).toHaveBeenCalledWith({
      jobId: "print-job-1",
      attemptId: "print-attempt-1",
      attemptNumber: 1,
      restaurantId: "restaurant-1",
      logicalTarget: "kitchen:main",
      documentId: "order-42:revision-3",
      documentType: "KITCHEN_TICKET",
      destinationId: "logical-printer-1",
      failure: { code: "PRINTER_UNAVAILABLE", retryable: true },
      retry: { action: "RETRY", nextAttemptNumber: 2 },
    });
    const report = fixture.report.mock.calls[0]?.[0];
    expect(JSON.stringify(report)).not.toContain("2 tacos");
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report?.failure)).toBe(true);
    expect(Object.isFrozen(report?.retry)).toBe(true);
  });

  it("never rejects when selection or error reporting throws", async () => {
    const fixture = dependencies();
    const selectionError = new Error("selector secret detail");
    fixture.select.mockRejectedValue(selectionError);
    fixture.report.mockRejectedValue(new Error("reporter unavailable"));

    const result = await fixture.facade.printAfterPersistence(request());

    expect(result).toEqual({
      status: "failed",
      jobId: "print-job-1",
      attemptId: "print-attempt-1",
      failure: { code: "PRINTER_SELECTION_FAILED", retryable: true },
      retry: { action: "STOP" },
    });
    expect(JSON.stringify(result)).not.toContain("secret detail");
    expect(fixture.print).not.toHaveBeenCalled();
    expect(fixture.report).toHaveBeenCalledOnce();
  });

  it("never rejects when printing, retry advice, and reporting all throw", async () => {
    const fixture = dependencies();
    fixture.print.mockRejectedValue(new Error("printer driver exploded"));
    fixture.decide.mockRejectedValue(new Error("retry service unavailable"));
    fixture.report.mockRejectedValue(new Error("reporter unavailable"));

    await expect(
      fixture.facade.printAfterPersistence(request()),
    ).resolves.toEqual({
      status: "failed",
      jobId: "print-job-1",
      attemptId: "print-attempt-1",
      failure: { code: "PRINTER_SERVICE_FAILED", retryable: true },
      retry: { action: "STOP" },
    });
    expect(fixture.report).toHaveBeenCalledWith(
      expect.objectContaining({ destinationId: "logical-printer-1" }),
    );
  });

  it.each([
    ["blank job ID", { jobId: " " }],
    ["blank attempt ID", { attemptId: "" }],
    ["blank restaurant ID", { restaurantId: "\t" }],
    ["blank logical target", { logicalTarget: "" }],
    ["zero attempt", { attemptNumber: 0 }],
    ["fractional attempt", { attemptNumber: 1.5 }],
    [
      "blank document ID",
      { document: { id: " ", type: "KITCHEN_TICKET", lines: [{ text: "x" }] } },
    ],
    [
      "empty document",
      { document: { id: "document-1", type: "KITCHEN_TICKET", lines: [] } },
    ],
    [
      "invalid line",
      {
        document: {
          id: "document-1",
          type: "KITCHEN_TICKET",
          lines: [{ text: 42 }],
        },
      },
    ],
  ])("sanitizes %s without calling a port", async (_label, overrides) => {
    const fixture = dependencies();

    const result = await fixture.facade.printAfterPersistence(
      request(overrides as Partial<PrintRequest>),
    );

    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.failure).toEqual({
      code: "INVALID_PRINT_REQUEST",
      retryable: false,
    });
    expect(fixture.select).not.toHaveBeenCalled();
    expect(fixture.print).not.toHaveBeenCalled();
    expect(fixture.decide).not.toHaveBeenCalled();
  });

  it("normalizes malformed retry advice to stop", async () => {
    const fixture = dependencies();
    fixture.print.mockResolvedValue({
      status: "failed",
      failure: { code: "PRINT_FAILED", retryable: true },
    });
    fixture.decide.mockResolvedValue({
      action: "RETRY",
      nextAttemptNumber: 1,
    });

    const result = await fixture.facade.printAfterPersistence(request());

    expect(result.status === "failed" && result.retry).toEqual({
      action: "STOP",
    });
  });

  it("never rejects for an accessor-bearing request", async () => {
    const fixture = dependencies();
    const malicious = Object.defineProperty({}, "jobId", {
      get: () => {
        throw new Error("getter should not escape");
      },
    });

    await expect(
      fixture.facade.printAfterPersistence(malicious as PrintRequest),
    ).resolves.toEqual({
      status: "failed",
      jobId: "unknown",
      attemptId: "unknown",
      failure: { code: "INVALID_PRINT_REQUEST", retryable: false },
      retry: { action: "STOP" },
    });
  });
});
