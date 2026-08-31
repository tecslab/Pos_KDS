import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorizeApiPermission: vi.fn(),
  createActiveOrderQueryService: vi.fn(),
  detail: vi.fn(),
  createOrderModificationService: vi.fn(),
  modify: vi.fn(),
  createOrderCancellationService: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("../../../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorizeApiPermission,
}));
vi.mock("../../../../../../lib/active-orders/server", () => ({
  createActiveOrderQueryService: dependencies.createActiveOrderQueryService,
}));
vi.mock("../../../../../../lib/order-modification/server", () => ({
  createOrderModificationService: dependencies.createOrderModificationService,
}));
vi.mock("../../../../../../lib/order-cancellation/server", () => ({
  createOrderCancellationService: dependencies.createOrderCancellationService,
}));

import { DELETE, GET, PATCH } from "./route";

const actorId = "10000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const lineId = "43000000-0000-4000-8000-000000000001";
const snapshotId = "44000000-0000-4000-8000-000000000001";
const productVersionId = "36000000-0000-4000-8000-000000000001";
const request = new Request(`http://localhost/api/v1/pos/orders/${orderId}`);
const context = (id = orderId) => ({
  params: Promise.resolve({ orderId: id }),
});

beforeEach(() => {
  dependencies.authorizeApiPermission.mockReset().mockResolvedValue({
    ok: true,
    value: { userId: actorId },
  });
  dependencies.createActiveOrderQueryService.mockReset().mockReturnValue({
    detail: dependencies.detail,
  });
  dependencies.detail.mockReset().mockResolvedValue({
    ok: true,
    value: { id: orderId, status: "PENDING", baskets: [] },
  });
  dependencies.createOrderModificationService.mockReset().mockReturnValue({
    modify: dependencies.modify,
  });
  dependencies.modify.mockReset().mockResolvedValue({
    ok: true,
    value: {
      orderId,
      status: "PENDING",
      totalAmount: "25.00",
      updatedAt: "2026-08-29T12:00:01.000Z",
      baskets: [],
    },
  });
  dependencies.createOrderCancellationService.mockReset().mockReturnValue({
    cancel: dependencies.cancel,
  });
  dependencies.cancel.mockReset().mockResolvedValue({
    ok: true,
    value: {
      orderId,
      orderNumber: "ORD-42",
      previousStatus: "READY",
      status: "CANCELLED",
      reason: "Customer requested cancellation",
      cancelledById: actorId,
      cancelledAt: "2026-08-30T10:00:00.000Z",
    },
  });
});

function modificationBody() {
  return {
    orderId: "client-controlled-order-id",
    actorId: "client-controlled-actor-id",
    sourceIp: "client-controlled-source-ip",
    expectedUpdatedAt: "2026-08-29T12:00:00.000Z",
    operations: [
      {
        kind: "add",
        basketId,
        clientCorrelationId: "line-add-1",
        productVersionId,
        quantity: 2,
        optionIds: [],
        removableIngredientIds: [],
        observations: "Sin cebolla",
        finalUnitPrice: "0.01",
      },
      {
        kind: "replace",
        lineId,
        expectedCurrentSnapshotId: snapshotId,
        quantity: 3,
        optionIds: [],
        removableIngredientIds: [],
        observations: null,
        revisionNumber: 999,
      },
      {
        kind: "remove",
        lineId: "43000000-0000-4000-8000-000000000002",
        expectedCurrentSnapshotId: "44000000-0000-4000-8000-000000000002",
        inventoryRollback: false,
      },
    ],
  };
}

function patchRequest(value: unknown): Request {
  return new Request(`http://localhost/api/v1/pos/orders/${orderId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

function deleteRequest(value: unknown): Request {
  return new Request(`http://localhost/api/v1/pos/orders/${orderId}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

function modificationFailure(code: string) {
  return {
    ok: false,
    error: Object.freeze({ kind: "order-modification-error", code }),
  };
}

function cancellationFailure(code: string) {
  return {
    ok: false,
    error: Object.freeze({ kind: "order-cancellation-error", code }),
  };
}

describe("DELETE /api/v1/pos/orders/:orderId", () => {
  it("cancels once for the authenticated actor with path-owned and public input", async () => {
    const response = await DELETE(
      deleteRequest({
        orderId: "client-controlled-order-id",
        actorId: "client-controlled-actor-id",
        reason: "Customer requested cancellation",
        sourceIp: "client-controlled-source-ip",
        refundPayment: true,
      }),
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      orderId,
      status: "CANCELLED",
      reason: "Customer requested cancellation",
    });
    expect(dependencies.authorizeApiPermission).toHaveBeenCalledWith(
      "orders.cancel",
    );
    expect(dependencies.createOrderCancellationService).toHaveBeenCalledOnce();
    expect(dependencies.cancel).toHaveBeenCalledOnce();
    expect(dependencies.cancel).toHaveBeenCalledWith(actorId, {
      orderId,
      reason: "Customer requested cancellation",
      sourceIp: null,
    });
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", 401, "Authentication is required."],
    ["UNAUTHORIZED", 403, "You are not authorized to perform this operation."],
  ] as const)(
    "returns %s before params, parsing, or privileged composition",
    async (code, status, message) => {
      dependencies.authorizeApiPermission.mockResolvedValue({
        ok: false,
        error: { code },
      });
      const params = { then: vi.fn() } as unknown as Promise<{
        orderId: string;
      }>;
      const json = vi.fn();

      const response = await DELETE({ json } as unknown as Request, { params });

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: { code, message },
      });
      expect(params.then).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(
        dependencies.createOrderCancellationService,
      ).not.toHaveBeenCalled();
      expect(dependencies.cancel).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for invalid JSON without composing cancellation", async () => {
    const invalidRequest = {
      json: vi.fn().mockRejectedValue(new SyntaxError("private body detail")),
    } as unknown as Request;

    const response = await DELETE(invalidRequest, context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "The request body must be valid JSON.",
      },
    });
    expect(dependencies.createOrderCancellationService).not.toHaveBeenCalled();
    expect(dependencies.cancel).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}, undefined],
    ["non-string", { reason: 42 }, 42],
    ["non-object", [], undefined],
  ])(
    "delegates a %s reason for domain validation",
    async (_label, body, reason) => {
      dependencies.cancel.mockResolvedValue(
        cancellationFailure("INVALID_CANCELLATION"),
      );

      const response = await DELETE(deleteRequest(body), context());

      expect(response.status).toBe(422);
      expect(dependencies.cancel).toHaveBeenCalledWith(actorId, {
        orderId,
        reason,
        sourceIp: null,
      });
    },
  );

  it.each([
    ["UNAUTHORIZED", 403, "You are not authorized to perform this operation."],
    ["INVALID_CANCELLATION", 422, "The order cancellation is invalid."],
    ["NOT_FOUND", 404, "The order was not found."],
    [
      "ORDER_NOT_CANCELLABLE",
      409,
      "Only pending or ready orders can be cancelled.",
    ],
  ] as const)(
    "returns the safe %s business failure",
    async (code, status, message) => {
      dependencies.cancel.mockResolvedValue(cancellationFailure(code));

      const response = await DELETE(
        deleteRequest({ reason: "Customer request" }),
        context(),
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: { code, message },
      });
      expect(dependencies.cancel).toHaveBeenCalledOnce();
    },
  );

  it.each([
    {
      label: "operation failure",
      arrange: () =>
        dependencies.cancel.mockResolvedValue(
          cancellationFailure("OPERATION_FAILED"),
        ),
    },
    {
      label: "malformed business-error lookalike",
      arrange: () =>
        dependencies.cancel.mockResolvedValue({
          ok: false,
          error: {
            kind: "order-cancellation-error",
            code: "ORDER_NOT_CANCELLABLE",
            detail: "secret-value",
          },
        }),
    },
    {
      label: "post-commit publication rejection",
      arrange: () =>
        dependencies.cancel.mockRejectedValue(
          new Error("private realtime provider detail"),
        ),
    },
    {
      label: "composition failure",
      arrange: () =>
        dependencies.createOrderCancellationService.mockImplementation(() => {
          throw new Error("private configuration detail");
        }),
    },
  ])("returns a sanitized 500 for $label", async ({ arrange }) => {
    arrange();

    const response = await DELETE(
      deleteRequest({ reason: "Customer request" }),
      context(),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private");
    expect(JSON.stringify(body)).not.toContain("secret-value");
    expect(dependencies.cancel.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("PATCH /api/v1/pos/orders/:orderId", () => {
  it("modifies once for the authenticated actor with path-owned and public input", async () => {
    const response = await PATCH(patchRequest(modificationBody()), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      orderId,
      status: "PENDING",
      totalAmount: "25.00",
    });
    expect(dependencies.authorizeApiPermission).toHaveBeenCalledWith(
      "orders.edit",
    );
    expect(dependencies.createOrderModificationService).toHaveBeenCalledOnce();
    expect(dependencies.modify).toHaveBeenCalledOnce();
    expect(dependencies.modify).toHaveBeenCalledWith(actorId, {
      orderId,
      expectedUpdatedAt: "2026-08-29T12:00:00.000Z",
      sourceIp: null,
      operations: [
        {
          kind: "add",
          basketId,
          clientCorrelationId: "line-add-1",
          productVersionId,
          quantity: 2,
          optionIds: [],
          removableIngredientIds: [],
          observations: "Sin cebolla",
        },
        {
          kind: "replace",
          lineId,
          expectedCurrentSnapshotId: snapshotId,
          quantity: 3,
          optionIds: [],
          removableIngredientIds: [],
          observations: null,
        },
        {
          kind: "remove",
          lineId: "43000000-0000-4000-8000-000000000002",
          expectedCurrentSnapshotId: "44000000-0000-4000-8000-000000000002",
        },
      ],
    });
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", 401, "Authentication is required."],
    ["UNAUTHORIZED", 403, "You are not authorized to perform this operation."],
  ] as const)(
    "returns %s before params, parsing, or privileged composition",
    async (code, status, message) => {
      dependencies.authorizeApiPermission.mockResolvedValue({
        ok: false,
        error: { code },
      });
      const params = { then: vi.fn() } as unknown as Promise<{
        orderId: string;
      }>;
      const json = vi.fn();

      const response = await PATCH({ json } as unknown as Request, { params });

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: { code, message },
      });
      expect(params.then).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(
        dependencies.createOrderModificationService,
      ).not.toHaveBeenCalled();
      expect(dependencies.modify).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for invalid JSON without composing modification", async () => {
    const invalidRequest = {
      json: vi.fn().mockRejectedValue(new SyntaxError("private body detail")),
    } as unknown as Request;

    const response = await PATCH(invalidRequest, context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "The request body must be valid JSON.",
      },
    });
    expect(dependencies.createOrderModificationService).not.toHaveBeenCalled();
    expect(dependencies.modify).not.toHaveBeenCalled();
  });

  it.each([
    ["UNAUTHORIZED", 403, "You are not authorized to perform this operation."],
    ["INVALID_MODIFICATION", 422, "The order modification is invalid."],
    ["NOT_FOUND", 404, "The order was not found."],
    ["ORDER_NOT_PENDING", 409, "Only pending orders can be modified."],
    ["STALE_ORDER", 409, "The order has changed since it was loaded."],
    [
      "STALE_CONFIGURATION",
      409,
      "The order uses configuration that is no longer available.",
    ],
    [
      "INSUFFICIENT_INVENTORY",
      409,
      "There is not enough inventory to complete the requested operation.",
    ],
  ] as const)(
    "returns the safe %s business failure",
    async (code, status, message) => {
      dependencies.modify.mockResolvedValue(modificationFailure(code));

      const response = await PATCH(patchRequest(modificationBody()), context());

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: { code, message },
      });
      expect(dependencies.modify).toHaveBeenCalledOnce();
    },
  );

  it.each([
    {
      label: "operation failure",
      arrange: () =>
        dependencies.modify.mockResolvedValue(
          modificationFailure("OPERATION_FAILED"),
        ),
    },
    {
      label: "malformed business-error lookalike",
      arrange: () =>
        dependencies.modify.mockResolvedValue({
          ok: false,
          error: {
            kind: "order-modification-error",
            code: "STALE_ORDER",
            detail: "secret-value",
          },
        }),
    },
    {
      label: "post-commit publication rejection",
      arrange: () =>
        dependencies.modify.mockRejectedValue(
          new Error("private realtime provider detail"),
        ),
    },
    {
      label: "composition failure",
      arrange: () =>
        dependencies.createOrderModificationService.mockImplementation(() => {
          throw new Error("private configuration detail");
        }),
    },
  ])("returns a sanitized 500 for $label", async ({ arrange }) => {
    arrange();

    const response = await PATCH(patchRequest(modificationBody()), context());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private");
    expect(JSON.stringify(body)).not.toContain("secret-value");
    expect(dependencies.modify.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("GET /api/v1/pos/orders/:orderId", () => {
  it("authorizes orders.view before returning persisted detail", async () => {
    const response = await GET(request, context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: orderId });
    expect(dependencies.authorizeApiPermission).toHaveBeenCalledWith(
      "orders.view",
    );
    expect(dependencies.detail).toHaveBeenCalledWith(orderId);
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", 401],
    ["UNAUTHORIZED", 403],
  ])(
    "returns %s before resolving params or composition",
    async (code, status) => {
      dependencies.authorizeApiPermission.mockResolvedValue({
        ok: false,
        error: { code },
      });
      const params = { then: vi.fn() } as unknown as Promise<{
        orderId: string;
      }>;

      const response = await GET(request, { params });

      expect(response.status).toBe(status);
      expect(params.then).not.toHaveBeenCalled();
      expect(dependencies.createActiveOrderQueryService).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["INVALID_ORDER_ID", 400, "INVALID_ORDER_ID"],
    ["NOT_FOUND", 404, "ORDER_NOT_FOUND"],
    ["OPERATION_FAILED", 500, "INTERNAL_ERROR"],
  ])("maps %s to a safe response", async (failure, status, code) => {
    dependencies.detail.mockResolvedValue({
      ok: false,
      error: { kind: "active-order-query-error", code: failure },
    });

    const response = await GET(request, context());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });
});
