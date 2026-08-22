import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("authenticated home", () => {
  it("renders a Spanish shell landing state without fake operational data", async () => {
    const markup = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("Centro de operaciones");
    expect(markup).toContain("Sesión verificada");
    expect(markup).toContain("Módulos en preparación");
    expect(markup).not.toMatch(/\$|ventas de hoy|pedidos activos/i);
  });

  it("shows generic sign-out failure feedback without provider details", async () => {
    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          session_error: "sign_out_failed",
          provider_error: "private detail",
        }),
      }),
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("No se pudo cerrar la sesión");
    expect(markup).not.toContain("private detail");
  });
});
