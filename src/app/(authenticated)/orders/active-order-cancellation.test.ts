import { describe, expect, it, vi } from "vitest";

import {
  ActiveOrderCancellationWorkflow,
  canExposeCancellation,
  cancellationActionState,
  cancellationFailure,
  type CancellationInput,
  type CancellationState,
} from "./active-order-cancellation";

const orderId = "41000000-0000-4000-8000-000000000001";
const input: CancellationInput = {
  orderId,
  reason: "  Customer requested cancellation  ",
};

function response(status: number, body: unknown = {}) {
  return { status, json: async () => body };
}

describe("active-order cancellation workflow", () => {
  it("fails closed for the rest of the page session after authorization is blocked", () => {
    expect(canExposeCancellation(true, false)).toBe(true);
    expect(canExposeCancellation(true, true)).toBe(false);
    expect(canExposeCancellation(false, false)).toBe(false);
  });

  it("requires a reason and explicit confirmation before enabling or sending", async () => {
    const transport = vi.fn().mockResolvedValue(response(200));
    const workflow = new ActiveOrderCancellationWorkflow(
      transport,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );

    expect(cancellationActionState({ status: "idle" }, "   ", true)).toEqual({
      disabled: true,
      label: "Confirmar cancelación",
    });
    expect(
      cancellationActionState({ status: "idle" }, "Customer request", false),
    ).toMatchObject({ disabled: true });
    expect(
      cancellationActionState({ status: "idle" }, "Customer request", true),
    ).toMatchObject({ disabled: false });

    await workflow.submit(input, false);
    await workflow.submit({ ...input, reason: "  " }, true);
    expect(transport).not.toHaveBeenCalled();
  });

  it("prevents duplicates and reports the committed cancellation outcome", async () => {
    let resolveResponse: (value: ReturnType<typeof response>) => void = () => {
      throw new Error("response was not requested");
    };
    const transport = vi.fn(
      () =>
        new Promise<ReturnType<typeof response>>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const states: CancellationState[] = [];
    const persisted = vi.fn();
    const workflow = new ActiveOrderCancellationWorkflow(
      transport,
      vi.fn(),
      (state) => states.push(state),
      persisted,
    );

    const first = workflow.submit(input, true);
    const second = workflow.submit(input, true);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith({
      orderId,
      reason: "Customer requested cancellation",
    });
    expect(
      cancellationActionState({ status: "pending" }, input.reason, true),
    ).toEqual({ disabled: true, label: "Cancelando orden…" });

    resolveResponse(
      response(200, {
        orderId,
        orderNumber: "ORD-42",
        status: "CANCELLED",
        reason: "Customer requested cancellation",
        cancelledAt: "2026-08-30T10:00:00.000Z",
      }),
    );
    await Promise.all([first, second]);

    const committedSummary = {
      orderId,
      orderNumber: "ORD-42",
      reason: "Customer requested cancellation",
      cancelledAt: "2026-08-30T10:00:00.000Z",
    };
    expect(states).toEqual([
      { status: "pending" },
      {
        status: "success",
        summary: committedSummary,
      },
    ]);
    expect(persisted).toHaveBeenCalledWith(committedSummary, {
      orderId,
      reason: "Customer requested cancellation",
    });

    await workflow.submit(input, true);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("preserves safe retry, reconciliation, and reload recovery for expected failures", async () => {
    expect(cancellationFailure(403, "UNAUTHORIZED")).toMatchObject({
      recovery: "blocked",
    });
    expect(cancellationFailure(404, "NOT_FOUND")).toMatchObject({
      recovery: "blocked",
    });
    expect(cancellationFailure(409, "ORDER_NOT_CANCELLABLE")).toMatchObject({
      recovery: "reload",
    });
    expect(cancellationFailure(422, "INVALID_CANCELLATION")).toMatchObject({
      recovery: "retry",
    });
    expect(cancellationFailure(500, "INTERNAL_ERROR")).toMatchObject({
      recovery: "reconcile",
    });

    const states: CancellationState[] = [];
    const workflow = new ActiveOrderCancellationWorkflow(
      async () => Promise.reject(new Error("offline")),
      vi.fn(),
      (state) => states.push(state),
      vi.fn(),
    );
    await workflow.submit(input, true);
    expect(states.at(-1)).toMatchObject({
      status: "error",
      recovery: "reconcile",
    });
  });

  it("does not invite a duplicate retry after a malformed committed response", async () => {
    const transport = vi.fn().mockResolvedValue(response(200, "unexpected"));
    const states: CancellationState[] = [];
    const persisted = vi.fn();
    const workflow = new ActiveOrderCancellationWorkflow(
      transport,
      vi.fn(),
      (state) => states.push(state),
      persisted,
    );

    await workflow.submit(input, true);
    await workflow.submit(input, true);

    expect(states.at(-1)).toEqual({
      status: "success",
      summary: {
        orderId,
        orderNumber: null,
        reason: "Customer requested cancellation",
        cancelledAt: null,
      },
    });
    expect(persisted).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledOnce();
  });

  it("blocks a repeat DELETE when a post-commit publication failure reconciles as inactive", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(response(500, { error: { code: "INTERNAL_ERROR" } }));
    const reconcile = vi.fn().mockResolvedValue(response(404));
    const states: CancellationState[] = [];
    const workflow = new ActiveOrderCancellationWorkflow(
      transport,
      reconcile,
      (state) => states.push(state),
      vi.fn(),
    );

    await workflow.submit(input, true);
    await workflow.submit(input, true);

    expect(transport).toHaveBeenCalledOnce();
    expect(states.at(-1)).toMatchObject({
      status: "error",
      recovery: "reconcile",
    });

    await workflow.reconcile();
    await workflow.submit(input, true);

    expect(reconcile).toHaveBeenCalledWith(orderId);
    expect(transport).toHaveBeenCalledOnce();
    expect(states.at(-1)).toMatchObject({
      status: "error",
      recovery: "blocked",
    });
  });

  it("allows an explicit retry after a lost response reconciles as still cancellable", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(
        response(200, {
          orderId,
          orderNumber: "ORD-42",
          status: "CANCELLED",
          reason: "Customer requested cancellation",
          cancelledAt: "2026-08-30T10:00:00.000Z",
        }),
      );
    const reconcile = vi.fn().mockResolvedValue(
      response(200, {
        id: orderId,
        status: "PENDING",
      }),
    );
    const states: CancellationState[] = [];
    const persisted = vi.fn();
    const workflow = new ActiveOrderCancellationWorkflow(
      transport,
      reconcile,
      (state) => states.push(state),
      persisted,
    );

    await workflow.submit(input, true);
    await workflow.submit(input, true);
    expect(transport).toHaveBeenCalledOnce();

    await workflow.reconcile();
    expect(states.at(-1)).toMatchObject({
      status: "error",
      recovery: "retry",
    });

    await workflow.submit(input, true);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(persisted).toHaveBeenCalledOnce();
  });

  it("notifies the UI when cancellation authorization is revoked", async () => {
    const authorizationBlocked = vi.fn();
    const states: CancellationState[] = [];
    const workflow = new ActiveOrderCancellationWorkflow(
      vi
        .fn()
        .mockResolvedValue(response(403, { error: { code: "UNAUTHORIZED" } })),
      vi.fn(),
      (state) => states.push(state),
      vi.fn(),
      authorizationBlocked,
    );

    await workflow.submit(input, true);

    expect(authorizationBlocked).toHaveBeenCalledOnce();
    expect(states.at(-1)).toMatchObject({
      status: "error",
      recovery: "blocked",
    });
  });
});
