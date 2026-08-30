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

  it("uses accessible, tablet-sized controls and labels for draft confirmation", async () => {
    const source = await readFile(
      new URL("./order-draft-composer.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('aria-label="Ubicación y cuentas"');
    expect(source).toContain('aria-label="Categorías de productos"');
    expect(source).toContain('aria-label="Total de la orden"');
    expect(source).toContain('aria-label="Disminuir cantidad"');
    expect(source).toContain('aria-label="Aumentar cantidad"');
    expect(source).toContain('aria-describedby="confirmation-feedback"');
    expect(source).toContain('role="alert"');
    expect(source).toContain('role="status"');
    expect(source).toContain("min-h-12");
    expect(source).toContain("aria-pressed");
  });

  it("uses the protected confirmation endpoint with pending-state duplicate protection", async () => {
    const source = await readFile(
      new URL("./order-draft-composer.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('fetch("/api/v1/pos/ordering-context"');
    expect(source).toContain('fetch("/api/v1/pos/orders"');
    expect(source).toContain('method: "POST"');
    expect(source).toContain("DraftConfirmationWorkflow");
    expect(source).toContain("confirmationAction.disabled");
    expect(source).toContain('dispatch({ type: "clear" })');
    expect(source).not.toMatch(/localStorage|sessionStorage|"use server"/);
    expect(source).not.toMatch(/action=|\.insert\(|\.update\(|\.delete\(/);
  });

  it("offers a separate accessible active-order editing workspace", async () => {
    const [workspace, editor] = await Promise.all([
      readFile(new URL("./orders-workspace.tsx", import.meta.url), "utf8"),
      readFile(new URL("./active-order-editor.tsx", import.meta.url), "utf8"),
    ]);

    expect(workspace).toContain('aria-label="Acciones del punto de venta"');
    expect(workspace).toContain("Editar orden activa");
    expect(editor).toContain('fetch("/api/v1/pos/orders"');
    expect(editor).toContain('method: "PATCH"');
    expect(editor).toContain('status === "PENDING"');
    expect(editor).toContain('aria-label="Edición de orden activa"');
    expect(editor).toContain('aria-describedby="active-order-save-feedback"');
    expect(editor).toContain("recoveryRequiresReload(saveState)");
    expect(editor).toContain("interactionDisabled");
    expect(editor).toContain("aria-label={`Antigüedad de la orden:");
    expect(editor).toContain("<OrderAge createdAt={order.createdAt}");
    expect(editor).toContain('role="alert"');
    expect(editor).toContain('role="status"');
    expect(editor).toContain("min-h-12");
    expect(editor).not.toMatch(
      /cancel|payment|\.insert\(|\.update\(|\.delete\(/i,
    );
  });
});
