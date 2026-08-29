import { describe, expect, it, vi } from "vitest";

import type { ActiveOrderReader } from "./active-orders";
import {
  ACTIVE_ORDER_STATUSES,
  ActiveOrderQueryService,
} from "./active-orders";

const orderId = "41000000-0000-4000-8000-000000000001";

function reader(overrides: Partial<ActiveOrderReader> = {}): ActiveOrderReader {
  return {
    listByStatuses: vi.fn().mockResolvedValue([]),
    findByIdAndStatuses: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("ActiveOrderQueryService", () => {
  it("defines and passes only the four operational states", async () => {
    const listByStatuses = vi.fn().mockResolvedValue([]);
    const service = new ActiveOrderQueryService(reader({ listByStatuses }));

    await expect(service.list()).resolves.toEqual({ ok: true, value: [] });
    expect(listByStatuses).toHaveBeenCalledWith(ACTIVE_ORDER_STATUSES);
    expect(ACTIVE_ORDER_STATUSES).toEqual([
      "PENDING",
      "READY",
      "ON_THE_WAY",
      "DELIVERED",
    ]);
    const result = await service.list();
    expect(result.ok && Object.isFrozen(result.value)).toBe(true);
  });

  it("rejects malformed identifiers before persistence and classifies missing detail", async () => {
    const findByIdAndStatuses = vi.fn().mockResolvedValue(null);
    const service = new ActiveOrderQueryService(
      reader({ findByIdAndStatuses }),
    );

    await expect(service.detail("not-an-id")).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_ORDER_ID" },
    });
    expect(findByIdAndStatuses).not.toHaveBeenCalled();
    await expect(service.detail(orderId)).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(findByIdAndStatuses).toHaveBeenCalledWith(
      orderId,
      ACTIVE_ORDER_STATUSES,
    );
  });

  it("fails closed for persistence failures and non-active rows", async () => {
    const failed = new ActiveOrderQueryService(
      reader({
        listByStatuses: vi.fn().mockRejectedValue(new Error("private")),
      }),
    );
    await expect(failed.list()).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });

    const malformed = new ActiveOrderQueryService(
      reader({
        listByStatuses: vi.fn().mockResolvedValue([{ status: "PAID" }]),
      } as Partial<ActiveOrderReader>),
    );
    await expect(malformed.list()).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
  });
});
