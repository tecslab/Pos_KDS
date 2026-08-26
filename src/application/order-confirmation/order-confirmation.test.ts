import { describe, expect, it, vi } from "vitest";

import { err, ok, type OrderConfirmed, type Result } from "../../domain";
import type { DomainEventPublisher } from "../domain-event-publisher";
import type { TransactionBoundary } from "../transaction-boundary";
import { TransactionalOperationRunner } from "../transactional-operation-runner";
import {
  OrderConfirmationService,
  type ConfirmedOrder,
  type ConfirmOrderInput,
  type OrderConfirmationError,
  type OrderConfirmationGateway,
} from "./order-confirmation";

const actorId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "30000000-0000-4000-8000-000000000001";
const locationId = "31000000-0000-4000-8000-000000000001";
const productVersionId = "36000000-0000-4000-8000-000000000002";
const optionOne = "37000000-0000-4000-8000-000000000001";
const optionTwo = "37000000-0000-4000-8000-000000000002";
const removalId = "38000000-0000-4000-8000-000000000001";

const confirmed: ConfirmedOrder = Object.freeze({
  orderId: "41000000-0000-4000-8000-000000000001",
  restaurantId,
  serviceLocationId: locationId,
  orderNumber: "ORD-42",
  assignedWaiterId: actorId,
  status: "PENDING",
  notes: "Para llevar",
  totalAmount: "10.00",
  confirmedAt: "2026-08-25T10:00:00.000Z",
  baskets: Object.freeze([
    Object.freeze({
      id: "42000000-0000-4000-8000-000000000001",
      status: "PENDING" as const,
      totalAmount: "10.00",
      lines: Object.freeze([]),
    }),
  ]),
});

function draft(): ConfirmOrderInput {
  return {
    serviceLocationId: locationId,
    notes: "  Para   llevar ",
    sourceIp: " 192.0.2.10 ",
    baskets: [
      { clientCorrelationId: "empty", lines: [] },
      {
        clientCorrelationId: "guest-1",
        lines: [
          {
            clientCorrelationId: "line-1",
            productVersionId,
            quantity: 1,
            optionIds: [optionTwo, optionOne],
            removableIngredientIds: [removalId],
            observations: " sin   picante ",
          },
          {
            clientCorrelationId: "line-2",
            productVersionId,
            quantity: 2,
            optionIds: [optionOne, optionTwo],
            removableIngredientIds: [removalId],
            observations: "sin picante",
          },
        ],
      },
    ],
  };
}

class RecordingBoundary implements TransactionBoundary {
  constructor(private readonly activity: string[]) {}

  async run<T, E>(work: () => Promise<Result<T, E>>) {
    this.activity.push("transaction:start");
    try {
      const result = await work();
      this.activity.push(
        result.ok ? "transaction:commit" : "transaction:rollback",
      );
      return result;
    } catch (error) {
      this.activity.push("transaction:rollback");
      throw error;
    }
  }
}

function setup(
  gatewayResult: Result<ConfirmedOrder, OrderConfirmationError> = ok(confirmed),
  overrides: {
    active?: boolean;
    permissions?: readonly string[];
    publisher?: DomainEventPublisher<OrderConfirmed>;
  } = {},
) {
  const activity: string[] = [];
  const gateway: OrderConfirmationGateway = {
    confirm: vi.fn().mockImplementation(async () => {
      activity.push("rpc");
      return gatewayResult;
    }),
  };
  const published: OrderConfirmed[] = [];
  const publisher =
    overrides.publisher ??
    ({
      async publish(events) {
        activity.push("publish");
        published.push(...events);
      },
    } satisfies DomainEventPublisher<OrderConfirmed>);
  const service = new OrderConfirmationService(
    {
      findByAuthenticatedUserId: vi.fn().mockResolvedValue({
        userId: actorId,
        displayName: "Ana",
        isActive: overrides.active ?? true,
        roleGrants: [
          {
            roleCode: "waiter",
            permissionCodes: overrides.permissions ?? ["orders.create"],
          },
        ],
      }),
    },
    gateway,
    { now: () => new Date("2026-08-25T10:00:00.000Z") },
    new TransactionalOperationRunner(
      new RecordingBoundary(activity),
      publisher,
    ),
  );
  return { activity, gateway, published, service };
}

describe("OrderConfirmationService", () => {
  it("authorizes, normalizes, omits empty baskets, groups lines, and publishes after commit", async () => {
    const { activity, gateway, published, service } = setup();

    await expect(service.confirm(actorId, draft())).resolves.toEqual(
      ok(confirmed),
    );
    expect(gateway.confirm).toHaveBeenCalledWith({
      actorId,
      serviceLocationId: locationId,
      notes: "Para llevar",
      sourceIp: "192.0.2.10",
      occurredAt: "2026-08-25T10:00:00.000Z",
      baskets: [
        {
          clientCorrelationId: "guest-1",
          lines: [
            {
              productVersionId,
              quantity: 3,
              optionIds: [optionOne, optionTwo],
              removableIngredientIds: [removalId],
              observations: "sin picante",
            },
          ],
        },
      ],
    });
    expect(activity).toEqual([
      "transaction:start",
      "rpc",
      "transaction:commit",
      "publish",
    ]);
    expect(published).toEqual([
      {
        type: "order.confirmed",
        occurredAt: confirmed.confirmedAt,
        payload: {
          orderId: confirmed.orderId,
          restaurantId,
          serviceLocationId: locationId,
          orderNumber: "ORD-42",
          assignedWaiterId: actorId,
          status: "PENDING",
          totalAmount: "10.00",
        },
      },
    ]);
  });

  it.each([
    ["empty order", { ...draft(), baskets: [] }],
    [
      "only empty baskets",
      { ...draft(), baskets: [{ clientCorrelationId: "empty", lines: [] }] },
    ],
    [
      "zero quantity",
      {
        ...draft(),
        baskets: [
          {
            clientCorrelationId: "one",
            lines: [
              {
                clientCorrelationId: "line",
                productVersionId,
                quantity: 0,
              },
            ],
          },
        ],
      },
    ],
    [
      "duplicate modification",
      {
        ...draft(),
        baskets: [
          {
            clientCorrelationId: "one",
            lines: [
              {
                clientCorrelationId: "line",
                productVersionId,
                quantity: 1,
                optionIds: [optionOne, optionOne],
              },
            ],
          },
        ],
      },
    ],
    [
      "reused line correlation",
      {
        ...draft(),
        baskets: [
          {
            clientCorrelationId: "one",
            lines: [
              {
                clientCorrelationId: "same",
                productVersionId,
                quantity: 1,
              },
            ],
          },
          {
            clientCorrelationId: "two",
            lines: [
              {
                clientCorrelationId: "same",
                productVersionId,
                quantity: 1,
              },
            ],
          },
        ],
      },
    ],
  ])("rejects %s before opening a transaction", async (_name, input) => {
    const { activity, gateway, service } = setup();
    await expect(
      service.confirm(actorId, input as ConfirmOrderInput),
    ).resolves.toEqual(
      err({ kind: "order-confirmation-error", code: "INVALID_DRAFT" }),
    );
    expect(gateway.confirm).not.toHaveBeenCalled();
    expect(activity).toEqual([]);
  });

  it.each([
    [false, ["orders.create"]],
    [true, ["orders.view"]],
  ])(
    "fails closed for an unauthorized profile",
    async (active, permissions) => {
      const { activity, gateway, service } = setup(undefined, {
        active,
        permissions,
      });
      await expect(service.confirm(actorId, draft())).resolves.toEqual(
        err({ kind: "order-confirmation-error", code: "UNAUTHORIZED" }),
      );
      expect(gateway.confirm).not.toHaveBeenCalled();
      expect(activity).toEqual([]);
    },
  );

  it("rolls back and emits nothing when the RPC rejects the confirmation", async () => {
    const { activity, published, service } = setup(
      err({
        kind: "order-confirmation-error",
        code: "LOCATION_UNAVAILABLE",
      }),
    );
    await expect(service.confirm(actorId, draft())).resolves.toEqual(
      err({
        kind: "order-confirmation-error",
        code: "LOCATION_UNAVAILABLE",
      }),
    );
    expect(activity).toEqual([
      "transaction:start",
      "rpc",
      "transaction:rollback",
    ]);
    expect(published).toEqual([]);
  });

  it("propagates a publisher failure after the RPC has committed", async () => {
    const publisherFailure = new Error("realtime unavailable");
    const activity: string[] = [];
    const { service } = setup(undefined, {
      publisher: {
        async publish() {
          activity.push("publish");
          throw publisherFailure;
        },
      },
    });
    await expect(service.confirm(actorId, draft())).rejects.toBe(
      publisherFailure,
    );
    expect(activity).toEqual(["publish"]);
  });
});
