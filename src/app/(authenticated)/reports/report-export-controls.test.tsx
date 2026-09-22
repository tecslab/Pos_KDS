// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReportExportControls } from "./report-export-controls";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const fetchMock = vi.fn();
const createObjectURL = vi.fn(() => "blob:report");
const revokeObjectURL = vi.fn();

function renderedControls() {
  const container = document.createElement("div");
  document.body.append(container);
  return { container, root: createRoot(container) };
}

async function mount(root: Root) {
  await act(async () => {
    root.render(
      <ReportExportControls
        restaurantId="30000000-0000-4000-8000-000000000001"
        date="2026-09-10"
        timeZone="America/Guayaquil"
      />,
    );
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: createObjectURL },
    revokeObjectURL: { configurable: true, value: revokeObjectURL },
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ReportExportControls", () => {
  it("renders accessible Spanish 48px PDF and Excel controls", async () => {
    const { container, root } = renderedControls();
    await mount(root);

    expect(container.textContent).toContain("Exportar reporte");
    expect(container.textContent).toContain("Descargar PDF");
    expect(container.textContent).toContain("Descargar Excel");
    expect(container.querySelectorAll("button")).toHaveLength(2);
    expect(container.innerHTML).toContain("min-h-12");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("posts filters only, downloads the returned artifact, and revokes its URL", async () => {
    fetchMock.mockResolvedValue(
      new Response("pdf", {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    );
    const { container, root } = renderedControls();
    await mount(root);

    await act(async () => {
      (container.querySelectorAll("button")[0] as HTMLButtonElement).click();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/reports/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantId: "30000000-0000-4000-8000-000000000001",
        date: "2026-09-10",
        timeZone: "America/Guayaquil",
        format: "pdf",
      }),
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:report");
    expect(container.textContent).toContain("La descarga está lista.");
    await act(async () => root.unmount());
  });

  it("announces a safe failure and re-enables both controls", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const { container, root } = renderedControls();
    await mount(root);

    await act(async () => {
      (container.querySelectorAll("button")[1] as HTMLButtonElement).click();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "No se pudo exportar el reporte",
    );
    expect(
      [...container.querySelectorAll("button")].every(
        (button) => !button.disabled,
      ),
    ).toBe(true);
    await act(async () => root.unmount());
  });
});
