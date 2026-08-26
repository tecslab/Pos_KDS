import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ authorize: vi.fn() }));

vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerPermission: dependencies.authorize,
}));

import OrdersPage from "./page";

describe("PoS draft composer UI", () => {
  it("protects the route with orders.create before rendering the composer", async () => {
    dependencies.authorize
      .mockReset()
      .mockResolvedValue({ userId: "waiter-1" });

    const markup = renderToStaticMarkup(await OrdersPage());

    expect(dependencies.authorize).toHaveBeenCalledWith(
      "orders.create",
      "/orders",
    );
    expect(markup).toContain("Nueva orden");
    expect(markup).toContain("Cargando ubicaciones y menú activo");
  });

  it("uses accessible, tablet-sized controls and labels for draft-only interactions", async () => {
    const source = await readFile(
      new URL("./order-draft-composer.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('aria-label="Ubicación y cuentas"');
    expect(source).toContain('aria-label="Categorías de productos"');
    expect(source).toContain('aria-label="Total de la orden"');
    expect(source).toContain('aria-label="Disminuir cantidad"');
    expect(source).toContain('aria-label="Aumentar cantidad"');
    expect(source).toContain("min-h-12");
    expect(source).toContain("aria-pressed");
  });

  it("fetches only the authorized ordering context and contains no persistence or confirmation boundary", async () => {
    const source = await readFile(
      new URL("./order-draft-composer.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('fetch("/api/v1/pos/ordering-context"');
    expect(source).not.toMatch(/localStorage|sessionStorage|"use server"/);
    expect(source).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(source).not.toContain("Confirmar orden");
    expect(source).not.toMatch(/action=|\.insert\(|\.update\(|\.delete\(/);
  });
});
