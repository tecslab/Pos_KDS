import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../login/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/image", () => ({ default: () => null }));

import AccessDeniedPage from "./page";

describe("access denied page", () => {
  it("explains the missing application authorization without provider details", () => {
    const markup = renderToStaticMarkup(<AccessDeniedPage />);

    expect(markup).toContain("Acceso no autorizado");
    expect(markup).toContain("perfil de empleado activo");
    expect(markup).toContain("Cerrar sesión");
    expect(markup).not.toMatch(/supabase|UNAUTHORIZED|business-error/i);
  });
});
