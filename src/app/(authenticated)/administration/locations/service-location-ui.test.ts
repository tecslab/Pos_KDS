import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("service location administration UI", () => {
  it("guards page and action with the exact persisted permission", async () => {
    const [page, actions] = await Promise.all([
      readFile(new URL("./page.tsx", import.meta.url), "utf8"),
      readFile(new URL("./actions.ts", import.meta.url), "utf8"),
    ]);
    expect(page).toContain('"administration.locations.manage"');
    expect(actions).toContain('"administration.locations.manage"');
  });

  it("exposes all location rules without restricting future types", async () => {
    const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    for (const name of [
      "name",
      "type",
      "displayOrder",
      "isActive",
      "allowsMultipleActiveOrders",
    ])
      expect(page).toContain(`name="${name}"`);
    expect(page).toContain('list="location-types"');
    expect(page).toContain("COUNTER");
    expect(page).toContain("min-h-12");
    expect(page).not.toMatch(/<select[^>]+name=["']type/i);
  });
});
