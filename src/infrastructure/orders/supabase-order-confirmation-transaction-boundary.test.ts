import { describe, expect, it, vi } from "vitest";

import { err, ok } from "../../domain";
import { SupabaseOrderConfirmationTransactionBoundary } from "./supabase-order-confirmation-transaction-boundary";

describe("SupabaseOrderConfirmationTransactionBoundary", () => {
  it("invokes the single-RPC work exactly once and preserves its result", async () => {
    const boundary = new SupabaseOrderConfirmationTransactionBoundary();
    const success = vi.fn().mockResolvedValue(ok("committed"));
    await expect(boundary.run(success)).resolves.toEqual(ok("committed"));
    expect(success).toHaveBeenCalledTimes(1);

    const rejected = vi.fn().mockResolvedValue(err("rolled-back"));
    await expect(boundary.run(rejected)).resolves.toEqual(err("rolled-back"));
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it("propagates an RPC rejection", async () => {
    const boundary = new SupabaseOrderConfirmationTransactionBoundary();
    const failure = new Error("RPC transport failed");
    await expect(
      boundary.run(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
