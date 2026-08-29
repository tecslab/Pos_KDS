import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorizeApiPermission: vi.fn(),
  createOrderConfirmationService: vi.fn(),
  confirm: vi.fn(),
  requestKitchenTicketAfterPersistence: vi.fn(),
}));

vi.mock("../../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorizeApiPermission,
}));
vi.mock("../../../../../lib/order-confirmation/server", () => ({
  createOrderConfirmationService: dependencies.createOrderConfirmationService,
}));
vi.mock("../../../../../lib/printing/server", () => ({
  requestKitchenTicketAfterPersistence:
    dependencies.requestKitchenTicketAfterPersistence,
}));

import { POST } from "./route";

const actorId = "10000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const productVersionId = "36000000-0000-4000-8000-000000000002";

const confirmedOrder = Object.freeze({
  orderId: "41000000-0000-4000-8000-000000000001",
  restaurantId: "30000000-0000-4000-8000-000000000001",
  serviceLocationId: locationId,
  orderNumber: "ORD-42",
  assignedWaiterId: actorId,
  status: "PENDING",
  notes: "Para llevar",
  totalAmount: "10.00",
  confirmedAt: "2026-08-25T10:00:00.000Z",
  baskets: [
    {
      id: "42000000-0000-4000-8000-000000000001",
      status: "PENDING",
      totalAmount: "10.00",
      lines: [],
    },
  ],
});

function draft() {
  return {
    serviceLocationId: locationId,
    notes: "Para llevar",
    sourceIp: "client-controlled",
    orderId: "client-order-id",
    status: "PAID",
    totalAmount: "0.01",
    baskets: [
      {
        clientCorrelationId: "guest-1",
        totalAmount: "0.01",
        lines: [
          {
            clientCorrelationId: "line-1",
            productVersionId,
            quantity: 2,
            optionIds: ["37000000-0000-4000-8000-000000000001"],
            removableIngredientIds: ["38000000-0000-4000-8000-000000000001"],
            observations: "Sin picante",
            unitPrice: "0.01",
          },
        ],
      },
    ],
  };
}

function jsonRequest(value: unknown): Request {
  return new Request("http://localhost/api/v1/pos/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

function failure(code: string) {
  return {
    ok: false,
    error: Object.freeze({ kind: "order-confirmation-error", code }),
  };
}

beforeEach(() => {
  dependencies.authorizeApiPermission.mockReset();
  dependencies.createOrderConfirmationService.mockReset();
  dependencies.confirm.mockReset();
  dependencies.requestKitchenTicketAfterPersistence.mockReset();
  dependencies.authorizeApiPermission.mockResolvedValue({
    ok: true,
    value: { userId: actorId },
  });
  dependencies.createOrderConfirmationService.mockReturnValue({
    confirm: dependencies.confirm,
  });
  dependencies.confirm.mockResolvedValue({
    ok: true,
    value: confirmedOrder,
  });
});

describe("POST /api/v1/pos/orders", () => {
  it("confirms once for the authenticated actor and returns the canonical order", async () => {
    const response = await POST(jsonRequest(draft()));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(confirmedOrder);
    expect(dependencies.authorizeApiPermission).toHaveBeenCalledOnce();
    expect(dependencies.authorizeApiPermission).toHaveBeenCalledWith(
      "orders.create",
    );
    expect(dependencies.createOrderConfirmationService).toHaveBeenCalledOnce();
    expect(dependencies.confirm).toHaveBeenCalledOnce();
    expect(dependencies.confirm).toHaveBeenCalledWith(actorId, {
      serviceLocationId: locationId,
      notes: "Para llevar",
      sourceIp: null,
      baskets: [
        {
          clientCorrelationId: "guest-1",
          lines: [
            {
              clientCorrelationId: "line-1",
              productVersionId,
              quantity: 2,
              optionIds: ["37000000-0000-4000-8000-000000000001"],
              removableIngredientIds: ["38000000-0000-4000-8000-000000000001"],
              observations: "Sin picante",
            },
          ],
        },
      ],
    });
    expect(
      dependencies.requestKitchenTicketAfterPersistence,
    ).toHaveBeenCalledWith(confirmedOrder);
  });

  it.each([
    {
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
      message: "Authentication is required.",
    },
    {
      code: "UNAUTHORIZED",
      status: 403,
      message: "You are not authorized to perform this operation.",
    },
  ])(
    "returns a sanitized $status before parsing or composition",
    async ({ code, status, message }) => {
      dependencies.authorizeApiPermission.mockResolvedValue({
        ok: false,
        error: { code },
      });
      const json = vi.fn();

      const response = await POST({ json } as unknown as Request);

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: { code, message },
      });
      expect(json).not.toHaveBeenCalled();
      expect(
        dependencies.createOrderConfirmationService,
      ).not.toHaveBeenCalled();
      expect(dependencies.confirm).not.toHaveBeenCalled();
      expect(
        dependencies.requestKitchenTicketAfterPersistence,
      ).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for invalid JSON without composing confirmation", async () => {
    const request = {
      json: vi.fn().mockRejectedValue(new SyntaxError("private body detail")),
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "The request body must be valid JSON.",
      },
    });
    expect(dependencies.createOrderConfirmationService).not.toHaveBeenCalled();
    expect(dependencies.confirm).not.toHaveBeenCalled();
    expect(
      dependencies.requestKitchenTicketAfterPersistence,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["UNAUTHORIZED", 403, "You are not authorized to perform this operation."],
    ["INVALID_DRAFT", 422, "The order draft is invalid."],
    [
      "LOCATION_UNAVAILABLE",
      409,
      "The service location cannot accept this order.",
    ],
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
      dependencies.confirm.mockResolvedValue(failure(code));

      const response = await POST(jsonRequest(draft()));

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: { code, message },
      });
      expect(dependencies.confirm).toHaveBeenCalledOnce();
      expect(
        dependencies.requestKitchenTicketAfterPersistence,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: "operation failure",
      arrange: () =>
        dependencies.confirm.mockResolvedValue(failure("OPERATION_FAILED")),
    },
    {
      label: "malformed business-error lookalike",
      arrange: () =>
        dependencies.confirm.mockResolvedValue({
          ok: false,
          error: {
            kind: "order-confirmation-error",
            code: "INVALID_DRAFT",
            detail: "secret-value",
          },
        }),
    },
    {
      label: "post-commit publication rejection",
      arrange: () =>
        dependencies.confirm.mockRejectedValue(
          new Error("private realtime provider detail"),
        ),
    },
    {
      label: "composition failure",
      arrange: () =>
        dependencies.createOrderConfirmationService.mockImplementation(() => {
          throw new Error("private configuration detail");
        }),
    },
  ])("returns a sanitized 500 for $label", async ({ arrange }) => {
    arrange();

    const response = await POST(jsonRequest(draft()));

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
    expect(dependencies.confirm.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("keeps persisted confirmation successful when ticket initiation throws", async () => {
    dependencies.requestKitchenTicketAfterPersistence.mockImplementation(() => {
      throw new Error("printer unavailable");
    });

    const response = await POST(jsonRequest(draft()));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(confirmedOrder);
    expect(
      dependencies.requestKitchenTicketAfterPersistence,
    ).toHaveBeenCalledWith(confirmedOrder);
  });
});
