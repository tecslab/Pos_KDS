import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorizeApiPermission: vi.fn(),
  createDeliveryQueueService: vi.fn(),
  read: vi.fn(),
}));

vi.mock("../../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorizeApiPermission,
}));
vi.mock("../../../../../lib/delivery-queue/server", () => ({
  createDeliveryQueueService: dependencies.createDeliveryQueueService,
}));

import { GET } from "./route";

const queueOrder = Object.freeze({
  id: "41000000-0000-4000-8000-000000000001",
  restaurantId: "30000000-0000-4000-8000-000000000001",
  orderNumber: "ORD-42",
  status: "READY",
  serviceLocation: {
    id: "31000000-0000-4000-8000-000000000001",
    name: "Mesa 1",
    type: "TABLE",
  },
  createdAt: "2026-09-01T10:00:00.000Z",
  readyAt: "2026-09-01T11:55:00.000Z",
  waitingTimeSeconds: 300,
  productCount: 2,
  specialObservations: ["Sin picante"],
});

function request(search = "") {
  return new Request(`http://localhost/api/v1/delivery/orders${search}`);
}

beforeEach(() => {
  dependencies.authorizeApiPermission.mockReset();
  dependencies.createDeliveryQueueService.mockReset();
  dependencies.read.mockReset();
  dependencies.authorizeApiPermission.mockResolvedValue({
    ok: true,
    value: { userId: "10000000-0000-4000-8000-000000000001" },
  });
  dependencies.createDeliveryQueueService.mockReturnValue({
    read: dependencies.read,
  });
  dependencies.read.mockResolvedValue({ ok: true, value: [queueOrder] });
});

describe("GET /api/v1/delivery/orders", () => {
  it("authorizes delivery access before returning Ready orders", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ orders: [queueOrder] });
    expect(dependencies.authorizeApiPermission).toHaveBeenCalledWith(
      "delivery.panel.view",
    );
    expect(dependencies.read).toHaveBeenCalledWith({
      serviceLocationId: undefined,
      orderNumber: undefined,
      minimumWaitingMinutes: undefined,
    });
  });

  it("defines the stable exact query contract for location, order number, and inclusive wait filters", async () => {
    const response = await GET(
      request(
        "?serviceLocationId=31000000-0000-4000-8000-000000000001&orderNumber=%20ORD-42%20&minimumWaitingMinutes=5",
      ),
    );

    expect(response.status).toBe(200);
    expect(dependencies.read).toHaveBeenCalledWith({
      serviceLocationId: "31000000-0000-4000-8000-000000000001",
      orderNumber: " ORD-42 ",
      minimumWaitingMinutes: "5",
    });
  });

  it.each([
    "?locationId=31000000-0000-4000-8000-000000000001",
    "?orderNumber=ORD-42&orderNumber=ORD-43",
    "?minimumWaitingMinutes=5&unsupported=value",
  ])("rejects unsupported or repeated query filters: %s", async (search) => {
    const response = await GET(request(search));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_FILTERS",
        message: "The delivery queue filters are invalid.",
      },
    });
    expect(dependencies.createDeliveryQueueService).not.toHaveBeenCalled();
    expect(dependencies.read).not.toHaveBeenCalled();
  });

  it("returns an empty authorized queue with status 200", async () => {
    dependencies.read.mockResolvedValue({ ok: true, value: [] });

    const response = await GET(request());

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

      const response = await GET(request("?unknown=value"));

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: { code, message },
      });
      expect(dependencies.createDeliveryQueueService).not.toHaveBeenCalled();
      expect(dependencies.read).not.toHaveBeenCalled();
    },
  );

  it("sanitizes application and composition failures", async () => {
    dependencies.read.mockResolvedValue({
      ok: false,
      error: { code: "OPERATION_FAILED", detail: "private" },
    });
    const applicationFailure = await GET(request());
    expect(applicationFailure.status).toBe(500);
    await expect(applicationFailure.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });

    dependencies.createDeliveryQueueService.mockImplementation(() => {
      throw new Error("private provider detail");
    });
    const compositionFailure = await GET(request());
    expect(compositionFailure.status).toBe(500);
    await expect(compositionFailure.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  });
});
