import { describe, expect, it } from "vitest";

import { mapInventoryAlertTransitions } from "./map-inventory-alert-transitions";

const active = Object.freeze({
  inventory_alert_id: "61000000-0000-4000-8000-000000000001",
  inventory_movement_id: "61000000-0000-4000-8000-000000000002",
  inventory_item_id: "61000000-0000-4000-8000-000000000003",
  status: "ACTIVE",
  threshold: "5",
  observed_balance: "4.5",
  occurred_at: "2026-09-07T10:00:00+00:00",
});

describe("mapInventoryAlertTransitions", () => {
  it("maps ordered strict-threshold transition snapshots", () => {
    expect(mapInventoryAlertTransitions([active])).toEqual([
      {
        inventoryAlertId: active.inventory_alert_id,
        inventoryMovementId: active.inventory_movement_id,
        inventoryItemId: active.inventory_item_id,
        status: "ACTIVE",
        threshold: "5.000",
        observedBalance: "4.500",
        occurredAt: "2026-09-07T10:00:00.000Z",
      },
    ]);
    expect(
      mapInventoryAlertTransitions([
        {
          ...active,
          status: "RESOLVED",
          observed_balance: "5.000",
        },
      ]),
    ).not.toBeNull();
  });

  it.each<readonly [unknown]>([
    [{ ...active, status: "ACTIVE", observed_balance: "5.000" }],
    [{ ...active, status: "RESOLVED", observed_balance: "4.999" }],
    [{ ...active, threshold: "-1" }],
    [{ ...active, occurred_at: "not-a-time" }],
    [{ ...active, unexpected: "field" }],
    [[active, active]],
  ])("rejects malformed or contradictory snapshots", (value) => {
    expect(mapInventoryAlertTransitions(value)).toBeNull();
  });
});
