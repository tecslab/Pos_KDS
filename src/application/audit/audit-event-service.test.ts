import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { AuditClock } from "./audit-clock";
import type { AuditEventAppender } from "./audit-event-appender";
import type {
  AuditEventRecord,
  JsonObject,
  RecordAuditEventInput,
} from "./audit-event";
import { AuditEventService } from "./audit-event-service";

const actorId = "10000000-0000-4000-8000-000000000001";
const entityId = "20000000-0000-4000-8000-000000000001";
const occurredAt = new Date("2026-08-18T18:30:00.000Z");

function validInput(
  overrides: Partial<RecordAuditEventInput> = {},
): RecordAuditEventInput {
  return {
    actorId,
    action: "order.cancelled",
    entityType: "order",
    entityId,
    previousValues: { status: "PENDING", nested: { attempts: [1, 2] } },
    newValues: { status: "CANCELLED" },
    sourceIp: "192.0.2.10",
    ...overrides,
  };
}

function serviceWith(
  append: AuditEventAppender["append"] = vi.fn().mockResolvedValue(undefined),
  now: AuditClock["now"] = () => occurredAt,
) {
  return {
    append,
    service: new AuditEventService({ append }, { now }),
  };
}

describe("AuditEventService", () => {
  it("appends and returns a detached, deeply immutable audit event", async () => {
    const append = vi.fn<AuditEventAppender["append"]>().mockResolvedValue();
    const previousValues = {
      status: "PENDING",
      nested: { attempts: [1, 2] },
    };
    const newValues = { status: "CANCELLED" };
    const { service } = serviceWith(append);

    const result = await service.record(
      validInput({ previousValues, newValues }),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        actorId,
        occurredAt: "2026-08-18T18:30:00.000Z",
        action: "order.cancelled",
        entityType: "order",
        entityId,
        previousValues,
        newValues,
        sourceIp: "192.0.2.10",
      },
    });
    expectTypeOf(result).toMatchTypeOf<
      | Readonly<{ ok: true; value: AuditEventRecord }>
      | Readonly<{ ok: false; error: unknown }>
    >();
    expect(append).toHaveBeenCalledOnce();

    if (!result.ok) {
      throw new Error("expected audit event recording to succeed");
    }

    expect(append).toHaveBeenCalledWith(result.value);
    expect(result.value.previousValues).not.toBe(previousValues);
    expect(result.value.newValues).not.toBe(newValues);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.previousValues)).toBe(true);
    expect(Object.isFrozen(result.value.previousValues?.nested)).toBe(true);
    expect(
      Object.isFrozen(
        (result.value.previousValues?.nested as JsonObject).attempts,
      ),
    ).toBe(true);

    previousValues.status = "READY";
    previousValues.nested.attempts.push(3);
    expect(result.value.previousValues).toEqual({
      status: "PENDING",
      nested: { attempts: [1, 2] },
    });
  });

  it("normalizes absent snapshots and source IP to null", async () => {
    const append = vi.fn<AuditEventAppender["append"]>().mockResolvedValue();
    const { service } = serviceWith(append);

    const result = await service.record(
      validInput({
        previousValues: undefined,
        newValues: undefined,
        sourceIp: undefined,
      }),
    );

    expect(result.ok && result.value).toMatchObject({
      previousValues: null,
      newValues: null,
      sourceIp: null,
    });
  });

  it.each([
    ["invalid actor UUID", { actorId: "actor-1" }],
    ["blank entity identifier", { entityId: "   " }],
    ["blank action", { action: "   " }],
    ["blank entity type", { entityType: "\t" }],
    ["blank source IP", { sourceIp: "" }],
    ["invalid IPv4 address", { sourceIp: "256.2.3.4" }],
    ["invalid IPv6 address", { sourceIp: "2001:::1" }],
  ] as const)("rejects %s before append", async (_label, overrides) => {
    const append = vi.fn<AuditEventAppender["append"]>().mockResolvedValue();
    const { service } = serviceWith(append);

    const result = await service.record(validInput(overrides));

    expect(result).toEqual({
      ok: false,
      error: { kind: "business-error", code: "INVALID_AUDIT_EVENT" },
    });
    expect(append).not.toHaveBeenCalled();
    expect(Object.isFrozen(result.ok ? null : result.error)).toBe(true);
  });

  it("accepts non-UUID natural and composite entity identifiers", async () => {
    const append = vi.fn<AuditEventAppender["append"]>().mockResolvedValue();
    const { service } = serviceWith(append);

    const naturalId = await service.record(
      validInput({ entityId: "order-number:CN-2026-0042" }),
    );
    const compositeId = await service.record(
      validInput({ entityId: "restaurant-1/table-7/active-order" }),
    );

    expect(naturalId.ok && naturalId.value.entityId).toBe(
      "order-number:CN-2026-0042",
    );
    expect(compositeId.ok && compositeId.value.entityId).toBe(
      "restaurant-1/table-7/active-order",
    );
    expect(append).toHaveBeenCalledTimes(2);
  });

  it.each(["203.0.113.4", "2001:db8::1", "::ffff:192.0.2.128"])(
    "accepts source IP %s",
    async (sourceIp) => {
      const { service } = serviceWith();

      const result = await service.record(validInput({ sourceIp }));

      expect(result.ok && result.value.sourceIp).toBe(sourceIp);
    },
  );

  it.each([
    ["array root", []],
    ["non-plain object", new Date("2026-08-18T00:00:00.000Z")],
    ["non-finite number", { value: Number.POSITIVE_INFINITY }],
    ["undefined value", { value: undefined }],
    ["bigint value", { value: BigInt(1) }],
    ["function value", { value: () => undefined }],
    ["symbol value", { value: Symbol("not-json") }],
  ])("rejects a snapshot containing %s", async (_label, snapshot) => {
    const append = vi.fn<AuditEventAppender["append"]>().mockResolvedValue();
    const { service } = serviceWith(append);

    const result = await service.record(
      validInput({ previousValues: snapshot as JsonObject }),
    );

    expect(result.ok).toBe(false);
    expect(append).not.toHaveBeenCalled();
  });

  it("rejects cyclic and accessor-bearing snapshot objects", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => "hidden behavior",
    });
    const append = vi.fn<AuditEventAppender["append"]>().mockResolvedValue();
    const { service } = serviceWith(append);

    expect(
      (
        await service.record(
          validInput({ previousValues: cyclic as JsonObject }),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await service.record(
          validInput({ previousValues: accessor as JsonObject }),
        )
      ).ok,
    ).toBe(false);
    expect(append).not.toHaveBeenCalled();
  });

  it("rejects an invalid clock value before append", async () => {
    const append = vi.fn<AuditEventAppender["append"]>().mockResolvedValue();
    const { service } = serviceWith(append, () => new Date(Number.NaN));

    const result = await service.record(validInput());

    expect(result.ok).toBe(false);
    expect(append).not.toHaveBeenCalled();
  });

  it("propagates append rejection unchanged", async () => {
    const failure = new Error("database unavailable");
    const append = vi
      .fn<AuditEventAppender["append"]>()
      .mockRejectedValue(failure);
    const { service } = serviceWith(append);

    await expect(service.record(validInput())).rejects.toBe(failure);
    expect(append).toHaveBeenCalledOnce();
  });
});
