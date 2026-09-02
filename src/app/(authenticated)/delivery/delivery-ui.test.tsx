import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createDeliveryQueueService: vi.fn(),
  createOperatingSettingsService: vi.fn(),
  readQueue: vi.fn(),
  listSettings: vi.fn(),
}));

vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerPermission: dependencies.authorize,
}));
vi.mock("@/lib/delivery-queue/server", () => ({
  createDeliveryQueueService: dependencies.createDeliveryQueueService,
}));
vi.mock("@/lib/operating-settings/server", () => ({
  createOperatingSettingsService: dependencies.createOperatingSettingsService,
}));

import DeliveryPage from "./page";

const restaurantId = "30000000-0000-4000-8000-000000000001";
const order = Object.freeze({
  id: "41000000-0000-4000-8000-000000000001",
  restaurantId,
  orderNumber: "ORD-42",
  status: "READY" as const,
  serviceLocation: {
    id: "31000000-0000-4000-8000-000000000001",
    name: "Mesa 4",
    type: "TABLE",
  },
  createdAt: "2026-09-01T10:00:00.000Z",
  readyAt: "2026-09-01T10:05:00.000Z",
  waitingTimeSeconds: 300,
  productCount: 2,
  specialObservations: ["Sin picante"],
});

beforeEach(() => {
  dependencies.authorize.mockReset().mockResolvedValue({
    userId: "10000000-0000-4000-8000-000000000001",
    permissionCodes: ["delivery.panel.view"],
  });
  dependencies.createDeliveryQueueService.mockReset().mockReturnValue({
    read: dependencies.readQueue,
  });
  dependencies.createOperatingSettingsService.mockReset().mockReturnValue({
    list: dependencies.listSettings,
  });
  dependencies.readQueue
    .mockReset()
    .mockResolvedValue({ ok: true, value: [order] });
  dependencies.listSettings.mockReset().mockResolvedValue({
    ok: true,
    value: [
      {
        restaurantId,
        deliveryWarningMinutes: 5,
        deliveryCriticalMinutes: 8,
      },
    ],
  });
});

describe("waiter delivery panel", () => {
  it("authorizes before loading and renders every Ready-queue field", async () => {
    const markup = renderToStaticMarkup(await DeliveryPage());

    expect(dependencies.authorize).toHaveBeenCalledWith(
      "delivery.panel.view",
      "/delivery",
    );
    expect(dependencies.readQueue).toHaveBeenCalledWith({});
    expect(markup).toContain("Órdenes listas");
    expect(markup).toContain("ORD-42");
    expect(markup).toContain("Mesa 4");
    expect(markup).toContain("2 productos");
    expect(markup).toContain("Sin picante");
    expect(markup).toContain("En tiempo");
  });

  it("does not compose queue dependencies after authorization denial", async () => {
    dependencies.authorize.mockRejectedValue(new Error("unauthorized"));

    await expect(DeliveryPage()).rejects.toThrow("unauthorized");
    expect(dependencies.createDeliveryQueueService).not.toHaveBeenCalled();
    expect(dependencies.createOperatingSettingsService).not.toHaveBeenCalled();
  });

  it("fails safely when thresholds do not cover all queue restaurants", async () => {
    dependencies.listSettings.mockResolvedValue({ ok: true, value: [] });

    const markup = renderToStaticMarkup(await DeliveryPage());

    expect(markup).toContain("No se pudo cargar entregas");
    expect(markup).not.toContain("ORD-42");
  });

  it("has touch-friendly filters, semantic status labels, and no delivery actions", async () => {
    const source = await readFile(
      new URL("./delivery-queue-board.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("min-h-12");
    expect(source).toContain('aria-label="Filtros de órdenes listas"');
    expect(source).toContain('aria-label="Órdenes listas para entregar"');
    expect(source).toContain("En tiempo");
    expect(source).toContain("Advertencia");
    expect(source).toContain("Crítica");
    expect(source).toContain("Tiempo esperando entrega:");
    expect(source).toContain("fetch(`/api/v1/delivery/orders${query}`");
    expect(source).toContain('method: "GET"');
    expect(source).not.toContain('method: "PATCH"');
    expect(source).not.toContain('method: "POST"');
    expect(source).not.toContain('.from("orders")');
    expect(source).not.toContain(".rpc(");
  });
});
