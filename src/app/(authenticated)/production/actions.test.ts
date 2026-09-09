import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireServerPermission, complete } = vi.hoisted(() => ({
  requireServerPermission: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerPermission,
}));
vi.mock("@/lib/production-batch-completion/server", () => ({
  createProductionBatchCompletionService: () => ({ complete }),
}));
vi.mock("@/lib/recipe-administration/server", () => ({
  createRecipeAdministrationService: () => ({ save: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { completeProductionBatch } from "./actions";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "20000000-0000-4000-8000-000000000001";
const recipeVersionId = "30000000-0000-4000-8000-000000000001";

function formData() {
  const data = new FormData();
  data.set("restaurantId", restaurantId);
  data.set("recipeVersionId", recipeVersionId);
  data.set("producedQuantity", "5.500");
  data.set("notes", "Preparación de la mañana");
  return data;
}

describe("completeProductionBatch", () => {
  beforeEach(() => {
    requireServerPermission.mockReset();
    complete.mockReset();
  });

  it("enforces the batch-create permission and sends only completion inputs to T-064", async () => {
    requireServerPermission.mockResolvedValue({ userId: actorId });
    complete.mockResolvedValue({
      ok: true,
      value: { producedQuantity: "5.500", unitOfMeasure: "unidad" },
    });

    await expect(completeProductionBatch(formData())).resolves.toEqual({
      status: "success",
      producedQuantity: "5.500",
      unitOfMeasure: "unidad",
    });
    expect(requireServerPermission).toHaveBeenCalledWith(
      "production.batch.create",
      "/production",
    );
    expect(complete).toHaveBeenCalledWith(actorId, {
      restaurantId,
      recipeVersionId,
      producedQuantity: "5.500",
      notes: "Preparación de la mañana",
    });
  });

  it("does not call the completion service when server authorization rejects", async () => {
    requireServerPermission.mockRejectedValue(new Error("Forbidden"));

    await expect(completeProductionBatch(formData())).rejects.toThrow(
      "Forbidden",
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it("gives an actionable alert for an atomic insufficient-stock rejection", async () => {
    requireServerPermission.mockResolvedValue({ userId: actorId });
    complete.mockResolvedValue({
      ok: false,
      error: { code: "INSUFFICIENT_INVENTORY" },
    });

    await expect(completeProductionBatch(formData())).resolves.toEqual({
      status: "error",
      message: expect.stringContaining("ingredientes suficientes"),
    });
  });
});
