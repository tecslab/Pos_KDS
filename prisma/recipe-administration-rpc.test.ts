import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260824160000_manage_recipes_atomically/migration.sql",
  import.meta.url,
);

describe("recipe administration RPC", () => {
  it("creates immutable N+1 recipe snapshots with atomic audit", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE FUNCTION public.save_recipe");
    expect(sql).toContain("current_version_number + 1");
    expect(sql).toContain("expected_previous_version_number");
    expect(sql).toContain("INSERT INTO public.recipe_versions");
    expect(sql).toContain("INSERT INTO public.recipe_ingredients");
    expect(sql).toContain("INSERT INTO public.audit_events");
    expect(sql).toContain("audit snapshot is stale");
    for (const action of ["created", "updated", "activated", "deactivated"])
      expect(sql).toContain(`recipe.${action}`);
    expect(sql).not.toMatch(/UPDATE public\.recipe_versions/i);
    expect(sql).not.toMatch(/DELETE FROM public\.recipe_/i);
  });

  it("locks and validates active same-restaurant raw/output/product references", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toMatch(/FROM public\.recipes[\s\S]+FOR UPDATE/);
    expect(sql).toContain("FOR KEY SHARE");
    expect(sql).toContain("type = 'PRODUCED_ITEM'");
    expect(sql).toContain("type = 'RAW_INGREDIENT'");
    expect(sql).toContain("recipe identity is immutable");
    expect(sql).toContain("recipe version is stale");
  });

  it("is service-role-only and never runs production or inventory movement writes", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.save_recipe\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.save_recipe\([\s\S]+TO service_role/,
    );
    expect(sql).not.toMatch(
      /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.production_batches/i,
    );
    expect(sql).not.toMatch(
      /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.inventory_movements/i,
    );
  });
});
