import { describe, expect, it, vi } from "vitest";

import { err, ok } from "../../domain";
import { SupabaseOrderModificationTransactionBoundary } from "./supabase-order-modification-transaction-boundary";

describe("SupabaseOrderModificationTransactionBoundary", () => {
  it("runs the single-RPC work once and preserves its result", async () => {
    const boundary = new SupabaseOrderModificationTransactionBoundary();
    const success = vi.fn().mockResolvedValue(ok("committed"));
    await expect(boundary.run(success)).resolves.toEqual(ok("committed"));
    expect(success).toHaveBeenCalledOnce();

    const rejected = vi.fn().mockResolvedValue(err("rolled-back"));
    await expect(boundary.run(rejected)).resolves.toEqual(err("rolled-back"));
    expect(rejected).toHaveBeenCalledOnce();
  });

  it("propagates an RPC rejection", async () => {
    const boundary = new SupabaseOrderModificationTransactionBoundary();
    const failure = new Error("RPC transport failed");

    await expect(
      boundary.run(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
