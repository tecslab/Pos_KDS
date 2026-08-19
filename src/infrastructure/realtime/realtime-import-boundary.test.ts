import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sourceRoot = new URL("../../", import.meta.url);

describe("realtime import boundary", () => {
  it.each(["application", "domain"])(
    "keeps Supabase SDK imports out of src/%s",
    async (boundary) => {
      const directory = new URL(`${boundary}/`, sourceRoot);
      const paths = await readdir(directory, { recursive: true });
      const sourcePaths = paths.filter(
        (path) => path.endsWith(".ts") && !path.endsWith(".test.ts"),
      );

      for (const path of sourcePaths) {
        const source = await readFile(new URL(path, directory), "utf8");
        expect(source, `${boundary}/${path}`).not.toContain("@supabase/");
      }
    },
  );
});
