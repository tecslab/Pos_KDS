import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const runbookUrl = new URL("./production-runbook.md", import.meta.url);
const readmeUrl = new URL("../../README.md", import.meta.url);

async function runbook() {
  return readFile(runbookUrl, "utf8");
}

describe("production operations runbook", () => {
  it("gates production on the unresolved T-077 operating policy", async () => {
    const text = await runbook();

    expect(text).toContain("## T-077 production release gates");
    for (const requiredGate of [
      "recovery point objective (RPO)",
      "recovery time objective (RTO)",
      "retention period",
      "named deployment",
      "on-call schedule",
      "contact method",
      "alert thresholds",
    ]) {
      expect(text).toContain(requiredGate);
    }
    expect(text).toContain("A missing or untested gate is a stop condition");
  });

  it("defines an ADR-001 compliant deploy and remote migration workflow", async () => {
    const text = await runbook();

    expect(text).toContain("env -u NODE_TLS_REJECT_UNAUTHORIZED npm run check");
    expect(text).toContain("env -u NODE_TLS_REJECT_UNAUTHORIZED npm run build");
    expect(text).toContain("`prisma/schema.prisma`");
    expect(text).toContain(
      "`prisma/migrations/<timestamp>_<migration-name>/migration.sql`",
    );
    expect(text).toContain("**Inspect through the connected Supabase MCP.**");
    expect(text).toContain("**Apply through Supabase MCP.**");
    expect(text).toContain("**Verify through Supabase MCP.**");
    expect(text).toContain("Never use a direct database URL");
    expect(text).toContain("`prisma migrate deploy`");
    expect(text).toContain("Do not run a mutation probe against");
  });

  it("separates application rollback from forward-only database correction", async () => {
    const text = await runbook();

    expect(text).toContain("**Application rollback:**");
    expect(text).toContain("**Database correction:**");
    expect(text).toContain("new reviewable forward-only SQL artifact");
    expect(text).toContain("This does not roll back the database");
    expect(text).toContain("do not run a down migration");
  });

  it("verifies backups with an isolated restore of every PRD protected entity", async () => {
    const text = await runbook();

    expect(text).toContain("## Backup verification");
    expect(text).toContain("## Isolated restore rehearsal");
    expect(text).toContain("Never restore over production for a rehearsal");
    for (const protectedEntity of [
      "**Orders:**",
      "**Payments:**",
      "**Inventory:**",
      "**Production:**",
      "**Audit history:**",
    ]) {
      expect(text).toContain(protectedEntity);
    }
    expect(text).toContain("actual recovery point");
    expect(text).toContain("actual restore time");
  });

  it("uses safe health signals and keeps realtime, telemetry, and audit distinct", async () => {
    const text = await runbook();

    expect(text).toContain("## Safe health signals");
    expect(text).toContain("Realtime Broadcast is non-durable");
    expect(text).toContain("authorized refetch from persisted storage");
    expect(text).toContain(
      "Operational telemetry is best effort and separate from immutable business",
    );
    expect(text).toContain("audit history is not a health");
    expect(text).toContain("Do not retry a business mutation based only on");
  });

  it("documents incident and secret rotation without credential values", async () => {
    const text = await runbook();

    expect(text).toContain("## Incident response");
    expect(text).toContain("## Secret rotation");
    for (const configurationName of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
    ]) {
      expect(text).toContain(configurationName);
    }
    expect(text).not.toMatch(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/);
    expect(text).not.toMatch(/postgres(?:ql)?:\/\//i);
  });

  it("is linked from the repository README", async () => {
    const readme = await readFile(readmeUrl, "utf8");

    expect(readme).toContain(
      "[production operations runbook](docs/operations/production-runbook.md)",
    );
  });
});
