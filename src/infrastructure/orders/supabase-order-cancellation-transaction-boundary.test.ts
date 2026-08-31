import { describe, expect, it, vi } from "vitest";

import { err, ok } from "../../domain";
import { SupabaseOrderCancellationTransactionBoundary } from "./supabase-order-cancellation-transaction-boundary";

describe("SupabaseOrderCancellationTransactionBoundary", () => {
  it("invokes the single-RPC work once and preserves its result", async () => {
    const boundary = new SupabaseOrderCancellationTransactionBoundary();
    const success = vi.fn().mockResolvedValue(ok("committed"));
    await expect(boundary.run(success)).resolves.toEqual(ok("committed"));
    expect(success).toHaveBeenCalledTimes(1);

    const rejected = vi.fn().mockResolvedValue(err("rolled-back"));
    await expect(boundary.run(rejected)).resolves.toEqual(err("rolled-back"));
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it("propagates RPC transport rejection", async () => {
    const failure = new Error("RPC transport failed");
    await expect(
      new SupabaseOrderCancellationTransactionBoundary().run(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
