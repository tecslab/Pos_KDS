import { describe, expect, it, vi } from "vitest";

import { instrumentSupabaseDatabaseClient } from "./instrument-supabase-client";

function clock(...values: number[]) {
  const now = vi.fn();
  for (const value of values) now.mockReturnValueOnce(value);
  return { now };
}

describe("instrumentSupabaseDatabaseClient", () => {
  it("measures chained queries without exposing relation, values, or rows", async () => {
    const record = vi.fn();
    const builder = {
      eq: vi.fn(function (this: unknown, _column: string, _value: string) {
        void _column;
        void _value;
        return this;
      }),
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(
          resolve({ data: [{ private: "secret-row" }], error: null }),
        );
      },
    };
    const client = {
      from: vi.fn((_relation: string) => {
        void _relation;
        return builder;
      }),
      channel: vi.fn(() => "untouched"),
    };
    const observed = instrumentSupabaseDatabaseClient(
      client,
      { record },
      clock(5, 13),
    );

    const result = await observed.from("private_table").eq("token", "secret");

    expect(result).toEqual({ data: [{ private: "secret-row" }], error: null });
    expect(record).toHaveBeenCalledWith({
      event: "database.operation",
      operation: "query",
      outcome: "success",
      durationMs: 8,
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain("private_table");
    expect(JSON.stringify(record.mock.calls)).not.toContain("secret-row");
    expect(observed.channel()).toBe("untouched");
  });

  it("reports sanitized RPC failures once and preserves the response", async () => {
    const record = vi.fn();
    const response = {
      data: null,
      error: { code: "23505", message: "duplicate secret payment" },
    };
    const client = {
      rpc: vi.fn((_name: string, _parameters: Record<string, unknown>) => {
        void _name;
        void _parameters;
        return {
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve(resolve(response));
          },
        };
      }),
    };
    const observed = instrumentSupabaseDatabaseClient(
      client,
      { record },
      clock(20, 24),
    );

    await expect(
      observed.rpc("private_rpc", { token: "secret" }),
    ).resolves.toBe(response);
    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith({
      event: "database.operation",
      operation: "rpc",
      outcome: "failure",
      durationMs: 4,
      errorClass: "DATABASE",
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain("duplicate secret");
  });

  it("preserves thrown failures when telemetry itself throws", () => {
    const failure = Object.assign(new Error("private database failure"), {
      code: "ECONNRESET",
    });
    const observed = instrumentSupabaseDatabaseClient(
      {
        from() {
          throw failure;
        },
      },
      {
        record() {
          throw new Error("telemetry unavailable");
        },
      },
      clock(2, 4),
    );

    expect(() => observed.from()).toThrow(failure);
  });
});
