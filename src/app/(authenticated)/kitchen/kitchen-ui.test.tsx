import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createKitchenQueueService: vi.fn(),
  createOperatingSettingsService: vi.fn(),
  readQueue: vi.fn(),
  listSettings: vi.fn(),
}));

vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerPermission: dependencies.authorize,
}));
vi.mock("@/lib/kitchen-queue/server", () => ({
  createKitchenQueueService: dependencies.createKitchenQueueService,
}));
vi.mock("@/lib/operating-settings/server", () => ({
  createOperatingSettingsService: dependencies.createOperatingSettingsService,
}));

import KitchenPage from "./page";

const restaurantId = "30000000-0000-4000-8000-000000000001";
const order = Object.freeze({
  id: "41000000-0000-4000-8000-000000000001",
  restaurantId,
  orderNumber: "ORD-42",
  status: "PENDING" as const,
  serviceLocation: {
    id: "31000000-0000-4000-8000-000000000001",
    name: "Mesa 4",
    type: "TABLE",
  },
  createdAt: "2026-08-31T10:00:00.000Z",
  lines: [
    {
      id: "43000000-0000-4000-8000-000000000001",
      productName: "Taco mixto",
      quantity: 2,
      selectedOptions: [
        {
          id: "37000000-0000-4000-8000-000000000001",
          name: "Extra queso",
        },
      ],
      removedIngredients: [
        {
          id: "38000000-0000-4000-8000-000000000001",
          name: "Cebolla",
        },
      ],
      observations: "Sin picante",
    },
  ],
});

beforeEach(() => {
  dependencies.authorize.mockReset().mockResolvedValue({
    userId: "10000000-0000-4000-8000-000000000001",
    permissionCodes: ["kitchen.queue.view"],
  });
  dependencies.createKitchenQueueService.mockReset().mockReturnValue({
    read: dependencies.readQueue,
  });
  dependencies.createOperatingSettingsService.mockReset().mockReturnValue({
    list: dependencies.listSettings,
  });
  dependencies.readQueue.mockReset().mockResolvedValue({
    ok: true,
    value: [order],
  });
  dependencies.listSettings.mockReset().mockResolvedValue({
    ok: true,
    value: [
      {
        restaurantId,
        preparationWarningMinutes: 5,
        preparationCriticalMinutes: 8,
      },
    ],
  });
});

describe("live kitchen queue UI", () => {
  it("authorizes the page before loading and renders configured queue details", async () => {
    const markup = renderToStaticMarkup(await KitchenPage());

    expect(dependencies.authorize).toHaveBeenCalledWith(
      "kitchen.queue.view",
      "/kitchen",
    );
    expect(markup).toContain("Cola de cocina");
    expect(markup).toContain("ORD-42");
    expect(markup).toContain("Mesa 4");
    expect(markup).toContain("2×");
    expect(markup).toContain("Extra queso");
    expect(markup).toContain("Sin: Cebolla");
    expect(markup).toContain("Observación: Sin picante");
    expect(markup).not.toMatch(/\$|precio|total|pago|listo/i);
  });

  it("does not compose privileged queue dependencies after authorization denial", async () => {
    dependencies.authorize.mockRejectedValue(new Error("unauthorized"));

    await expect(KitchenPage()).rejects.toThrow("unauthorized");
    expect(dependencies.createKitchenQueueService).not.toHaveBeenCalled();
    expect(dependencies.createOperatingSettingsService).not.toHaveBeenCalled();
  });

  it("exposes the Ready action only from persisted server permission context", async () => {
    dependencies.authorize.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000001",
      permissionCodes: ["kitchen.queue.view", "kitchen.ready.mark"],
    });

    const markup = renderToStaticMarkup(await KitchenPage());

    expect(markup).toContain("Listo");
    expect(markup).toContain("min-h-12");
  });

  it("fails safely when queue thresholds cannot be configured", async () => {
    dependencies.listSettings.mockResolvedValue({ ok: true, value: [] });

    const markup = renderToStaticMarkup(await KitchenPage());

    expect(markup).toContain("No se pudo cargar la cocina");
    expect(markup).not.toContain("ORD-42");
  });

  it("uses tablet-friendly and non-color semantic cues with an API-only mutation", async () => {
    const source = await readFile(
      new URL("./kitchen-queue-board.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("--kds-card-min");
    expect(source).toContain("min-h-12");
    expect(source).toContain('aria-label="Órdenes pendientes de cocina"');
    expect(source).toContain("En tiempo");
    expect(source).toContain("Advertencia");
    expect(source).toContain("Crítica");
    expect(source).toContain("aria-label={`Antigüedad de la orden:");
    expect(source).toContain('fetch("/api/v1/kitchen/orders"');
    expect(source).toContain('method: "GET"');
    expect(source).toContain('method: "PATCH"');
    expect(source).not.toContain('.from("orders")');
    expect(source).not.toContain(".rpc(");
  });
});
