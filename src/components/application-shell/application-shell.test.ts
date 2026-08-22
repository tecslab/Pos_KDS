import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const shellPath = new URL("./application-shell.tsx", import.meta.url);
const navigationPath = new URL("./shell-navigation.tsx", import.meta.url);
const layoutPath = new URL("../../app/layout.tsx", import.meta.url);
const authenticatedLayoutPath = new URL(
  "../../app/(authenticated)/layout.tsx",
  import.meta.url,
);

describe("authenticated application shell", () => {
  it("uses the approved logo, Spanish locale, responsive regions, and touch targets", async () => {
    const [shell, navigation, rootLayout] = await Promise.all([
      readFile(shellPath, "utf8"),
      readFile(navigationPath, "utf8"),
      readFile(layoutPath, "utf8"),
    ]);

    expect(shell).toContain("carnalesComp.png");
    expect(shell).toContain("Sesión activa");
    expect(shell).toContain("Cerrar sesión");
    expect(shell).toContain("md:grid");
    expect(shell).toContain("min-h-12");
    expect(navigation).toContain('aria-label="Navegación principal"');
    expect(navigation).toContain('aria-current={active ? "page" : undefined}');
    expect(rootLayout).toContain('<html lang="es">');
  });

  it("uses the exact tablet sidebar width from the product style guide", async () => {
    const globals = await readFile(
      new URL("../../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(globals).toContain("--sidebar-width: 280px");
  });

  it("receives server-filtered persisted permissions without becoming an auth boundary", async () => {
    const [navigation, layout] = await Promise.all([
      readFile(navigationPath, "utf8"),
      readFile(authenticatedLayoutPath, "utf8"),
    ]);

    expect(layout).toContain("requireServerAuthorizationContext");
    expect(layout).toContain("buildNavigation(context.permissionCodes)");
    expect(navigation).not.toMatch(
      /roleCodes|evaluatePermission|requireServerPermission/,
    );
    expect(navigation).toContain("Presentation-only");
  });
});
