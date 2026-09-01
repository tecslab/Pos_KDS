import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorizeApiPermission: vi.fn(),
  createKitchenQueueService: vi.fn(),
  read: vi.fn(),
}));

vi.mock("../../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorizeApiPermission,
}));
vi.mock("../../../../../lib/kitchen-queue/server", () => ({
  createKitchenQueueService: dependencies.createKitchenQueueService,
}));

import { GET } from "./route";

const queueOrder = Object.freeze({
  id: "41000000-0000-4000-8000-000000000001",
  orderNumber: "ORD-42",
  status: "PENDING",
  serviceLocation: {
    id: "31000000-0000-4000-8000-000000000001",
    name: "Mesa 1",
    type: "TABLE",
  },
  createdAt: "2026-08-31T10:00:00.000Z",
  lines: [
    {
      id: "43000000-0000-4000-8000-000000000001",
      productName: "Taco mixto",
      quantity: 2,
      selectedOptions: [],
      removedIngredients: [],
      observations: "Sin picante",
    },
  ],
});

beforeEach(() => {
  dependencies.authorizeApiPermission.mockReset();
  dependencies.createKitchenQueueService.mockReset();
  dependencies.read.mockReset();
  dependencies.authorizeApiPermission.mockResolvedValue({
    ok: true,
    value: { userId: "10000000-0000-4000-8000-000000000001" },
  });
  dependencies.createKitchenQueueService.mockReturnValue({
    read: dependencies.read,
  });
  dependencies.read.mockResolvedValue({ ok: true, value: [queueOrder] });
});

describe("GET /api/v1/kitchen/orders", () => {
  it("authorizes the kitchen queue permission before returning pending orders", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ orders: [queueOrder] });
    expect(dependencies.authorizeApiPermission).toHaveBeenCalledWith(
      "kitchen.queue.view",
    );
    expect(dependencies.createKitchenQueueService).toHaveBeenCalledOnce();
    expect(dependencies.read).toHaveBeenCalledOnce();
  });

  it("returns an empty authorized queue with status 200", async () => {
    dependencies.read.mockResolvedValue({ ok: true, value: [] });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ orders: [] });
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
    "returns a sanitized $status before privileged composition",
    async ({ code, status, message }) => {
      dependencies.authorizeApiPermission.mockResolvedValue({
        ok: false,
        error: { code },
      });

      const response = await GET();

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: { code, message },
      });
      expect(dependencies.createKitchenQueueService).not.toHaveBeenCalled();
      expect(dependencies.read).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: "application failure",
      arrange: () =>
        dependencies.read.mockResolvedValue({
          ok: false,
          error: {
            kind: "kitchen-queue-error",
            code: "OPERATION_FAILED",
            detail: "private",
          },
        }),
    },
    {
      label: "composition failure",
      arrange: () =>
        dependencies.createKitchenQueueService.mockImplementation(() => {
          throw new Error("private provider detail");
        }),
    },
  ])("returns a sanitized 500 for $label", async ({ arrange }) => {
    arrange();

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  });
});
