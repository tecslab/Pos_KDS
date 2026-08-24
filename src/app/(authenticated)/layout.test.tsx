import { describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  requireServerAuthorizationContext: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("@/application", () => ({ buildNavigation: vi.fn() }));
vi.mock("@/components/application-shell", () => ({
  ApplicationShell: () => null,
}));
vi.mock("@/domain", () => ({
  isBusinessError: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "UNAUTHORIZED",
}));
vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerAuthorizationContext:
    dependencies.requireServerAuthorizationContext,
}));
vi.mock("../login/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: dependencies.redirect }));

import AuthenticatedLayout from "./layout";

describe("authenticated layout", () => {
  it("redirects a persisted authorization denial to the access-denied page", async () => {
    dependencies.requireServerAuthorizationContext.mockRejectedValue({
      kind: "business-error",
      code: "UNAUTHORIZED",
    });

    await expect(AuthenticatedLayout({ children: null })).rejects.toThrow(
      "redirect:/access-denied",
    );
    expect(dependencies.redirect).toHaveBeenCalledWith("/access-denied");
  });
});
