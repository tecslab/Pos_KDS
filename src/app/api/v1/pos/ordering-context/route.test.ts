import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorizeApiPermission: vi.fn(),
  createPosOrderingContextService: vi.fn(),
  read: vi.fn(),
}));

vi.mock("../../../../../lib/auth/api-authorization", () => ({
  authorizeApiPermission: dependencies.authorizeApiPermission,
}));
vi.mock("../../../../../lib/pos-ordering-context/server", () => ({
  createPosOrderingContextService: dependencies.createPosOrderingContextService,
}));

import { GET } from "./route";

const context = {
  restaurants: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      name: "Carnales",
      serviceLocations: [
        {
          id: "31000000-0000-4000-8000-000000000001",
          name: "Mesa 1",
          type: "TABLE",
          displayOrder: 1,
          allowsMultipleActiveOrders: false,
        },
      ],
      categories: [
        {
          id: "33000000-0000-4000-8000-000000000001",
          name: "Tacos",
          displayOrder: 1,
          products: [
            {
              id: "35000000-0000-4000-8000-000000000001",
              productVersionId: "36000000-0000-4000-8000-000000000002",
              versionNumber: 2,
              name: "Taco mixto",
              printerAlias: "COCINA",
              displayOrder: 1,
              unitPrice: 4.5,
              tax: {
                taxRateId: "34000000-0000-4000-8000-000000000001",
                code: "IVA",
                name: "IVA 15%",
                rate: 0.15,
                priceIncludesTax: true,
              },
              options: [
                {
                  id: "37000000-0000-4000-8000-000000000001",
                  name: "Extra queso",
                  priceAdjustment: 0.5,
                  displayOrder: 0,
                },
              ],
              removableIngredients: [
                {
                  id: "38000000-0000-4000-8000-000000000001",
                  name: "Sin cebolla",
                  priceAdjustment: null,
                  displayOrder: 0,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  dependencies.authorizeApiPermission.mockReset();
  dependencies.createPosOrderingContextService.mockReset();
  dependencies.read.mockReset();
  dependencies.authorizeApiPermission.mockResolvedValue({
    ok: true,
    value: { userId: "user-1" },
  });
  dependencies.createPosOrderingContextService.mockReturnValue({
    read: dependencies.read,
  });
  dependencies.read.mockResolvedValue({ ok: true, value: context });
});

describe("GET /api/v1/pos/ordering-context", () => {
  it("returns the exact authorized ordering-context contract", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(context);
    expect(dependencies.authorizeApiPermission).toHaveBeenCalledWith(
      "orders.create",
    );
    expect(dependencies.createPosOrderingContextService).toHaveBeenCalledOnce();
  });

  it("returns an empty authorized result with status 200", async () => {
    dependencies.read.mockResolvedValue({
      ok: true,
      value: { restaurants: [] },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ restaurants: [] });
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
    "returns a sanitized $status and does not construct the privileged reader",
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
      expect(
        dependencies.createPosOrderingContextService,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: "sanitized application failure",
      arrange: () =>
        dependencies.read.mockResolvedValue({
          ok: false,
          error: {
            kind: "pos-ordering-context-error",
            code: "OPERATION_FAILED",
          },
        }),
    },
    {
      label: "unexpected composition failure",
      arrange: () =>
        dependencies.createPosOrderingContextService.mockImplementation(() => {
          throw new Error("private configuration detail");
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
