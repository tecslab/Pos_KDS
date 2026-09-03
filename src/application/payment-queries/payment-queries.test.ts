import { describe, expect, it, vi } from "vitest";

import { ok } from "../../domain";
import {
  PaymentQueryService,
  type PaymentQueryReader,
  type PendingPaymentOrder,
} from "./payment-queries";

const orderId = "41000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";

const order = Object.freeze({
  id: orderId,
  restaurantId: "30000000-0000-4000-8000-000000000001",
  orderNumber: "ORD-42",
  status: "DELIVERED",
  serviceLocation: Object.freeze({
    id: locationId,
    name: "Table 1",
    type: "TABLE",
  }),
  assignedWaiter: Object.freeze({
    id: "10000000-0000-4000-8000-000000000002",
    displayName: "Ana",
  }),
  totalAmount: "10.00",
  paidAmount: "4.00",
  outstandingBalance: "6.00",
  createdAt: "2026-09-03T09:00:00.000Z",
  deliveredAt: "2026-09-03T10:00:00.000Z",
  baskets: Object.freeze([]),
}) satisfies PendingPaymentOrder;

function setup() {
  const reader: PaymentQueryReader = {
    listUnpaid: vi.fn().mockResolvedValue([order]),
    findUnpaidById: vi.fn().mockResolvedValue(order),
  };
  return { reader, service: new PaymentQueryService(reader) };
}

describe("PaymentQueryService", () => {
  it("normalizes exact filters and returns unpaid orders", async () => {
    const { reader, service } = setup();

    await expect(
      service.list({
        serviceLocationId: locationId,
        orderNumber: " ORD-42 ",
      }),
    ).resolves.toEqual(ok([order]));
    expect(reader.listUnpaid).toHaveBeenCalledWith({
      serviceLocationId: locationId,
      orderNumber: "ORD-42",
    });
  });

  it.each([
    { serviceLocationId: "bad" },
    { orderNumber: "   " },
    { orderNumber: "x".repeat(101) },
  ])("rejects invalid filters before persistence", async (filters) => {
    const { reader, service } = setup();

    await expect(service.list(filters)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_FILTERS" },
    });
    expect(reader.listUnpaid).not.toHaveBeenCalled();
  });

  it("validates identifiers and exact detail identity", async () => {
    const { reader, service } = setup();

    await expect(service.detail("bad")).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_ORDER_ID" },
    });
    expect(reader.findUnpaidById).not.toHaveBeenCalled();

    await expect(service.detail(orderId)).resolves.toEqual(ok(order));
    expect(reader.findUnpaidById).toHaveBeenCalledWith(orderId);
  });

  it("returns not found without leaking persistence behavior", async () => {
    const { reader, service } = setup();
    vi.mocked(reader.findUnpaidById).mockResolvedValue(null);

    await expect(service.detail(orderId)).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("fails closed for paid projections, identity mismatches, and reader failures", async () => {
    const { reader, service } = setup();
    vi.mocked(reader.listUnpaid).mockResolvedValue([
      { ...order, status: "PAID" } as unknown as PendingPaymentOrder,
    ]);
    await expect(service.list({})).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });

    vi.mocked(reader.findUnpaidById).mockResolvedValue({
      ...order,
      id: "41000000-0000-4000-8000-000000000002",
    });
    await expect(service.detail(orderId)).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });

    vi.mocked(reader.listUnpaid).mockRejectedValue(new Error("private"));
    await expect(service.list({})).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATION_FAILED" },
    });
  });
});
