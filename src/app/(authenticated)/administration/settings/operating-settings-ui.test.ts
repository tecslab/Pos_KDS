import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("operating settings administration UI", () => {
  it("guards page and mutation with the exact persisted permission", async () => {
    const [page, actions] = await Promise.all([
      readFile(new URL("./page.tsx", import.meta.url), "utf8"),
      readFile(new URL("./actions.ts", import.meta.url), "utf8"),
    ]);
    expect(page).toContain('"administration.restaurant.configure"');
    expect(actions).toContain('"administration.restaurant.configure"');
  });

  it("renders only approved Spanish fields with touch-safe controls", async () => {
    const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    for (const field of [
      "restaurantName",
      "taxRatePercent",
      "taxName",
      "opensAt",
      "closesAt",
      "allowNegativeStock",
    ]) {
      expect(page).toContain(`name="${field}"`);
    }
    expect(page).toContain("name={`${prefix}WarningMinutes`}");
    expect(page).toContain("name={`${prefix}CriticalMinutes`}");
    expect(page).toContain('prefix="preparation"');
    expect(page).toContain('prefix="delivery"');
    expect(page).toContain("Configuración preservada");
    expect(page).toContain("min-h-12");
    expect(page).not.toMatch(
      /name=["'](?:address|taxId|logo|receipt|printer|contact)/i,
    );
  });
});
