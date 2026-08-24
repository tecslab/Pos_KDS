import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("payment method administration UI", () => {
  it("guards page and mutation with the exact persisted permission", async () => {
    const [page, actions] = await Promise.all([
      readFile(new URL("./page.tsx", import.meta.url), "utf8"),
      readFile(new URL("./actions.ts", import.meta.url), "utf8"),
    ]);
    expect(page).toContain('"administration.payment_methods.configure"');
    expect(actions).toContain('"administration.payment_methods.configure"');
  });
  it("exposes approved method, bank, receipt and ordering fields in Spanish", async () => {
    const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    for (const name of [
      "code",
      "name",
      "displayOrder",
      "isActive",
      "isBankTransfer",
      "bankName",
      "accountHolder",
      "accountNumber",
      "receiptHeader",
      "receiptFooter",
    ])
      expect(page).toContain(`name="${name}"`);
    expect(page).toMatch(/pagos históricos conservan su nombre original/);
    expect(page).toContain("min-h-12");
    expect(page).not.toMatch(/gateway|hardware|contraseña/i);
  });
});
