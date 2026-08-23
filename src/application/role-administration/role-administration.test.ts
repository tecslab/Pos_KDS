import { describe, expect, it, vi } from "vitest";

import { AuditEventService, type AuditEventRecord } from "../audit";
import {
  RoleAdministrationService,
  type RoleAdministrationGateway,
} from "./role-administration";

const actorId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const roleOne = "30000000-0000-4000-8000-000000000001";
const roleTwo = "30000000-0000-4000-8000-000000000002";

function setup(appendOverride?: (event: AuditEventRecord) => Promise<void>) {
  const gateway: RoleAdministrationGateway = {
    listRoles: vi.fn().mockResolvedValue([]),
    listEmployees: vi.fn().mockResolvedValue([]),
    replaceRoles: vi.fn().mockResolvedValue({
      previousRoleIds: [roleOne],
      assignedRoleIds: [roleOne, roleTwo],
    }),
  };
  const events: AuditEventRecord[] = [];
  const append =
    appendOverride ??
    (async (event: AuditEventRecord) => void events.push(event));
  const audit = new AuditEventService(
    { append },
    { now: () => new Date("2026-08-22T18:00:00.000Z") },
  );
  return {
    gateway,
    events,
    service: new RoleAdministrationService(gateway, audit),
  };
}

describe("RoleAdministrationService", () => {
  it("replaces a unique nonempty multi-role assignment and audits intent/outcome", async () => {
    const { service, gateway, events } = setup();

    const result = await service.replaceRoles(actorId, {
      userId,
      roleIds: [roleTwo, roleOne],
    });

    expect(result.ok).toBe(true);
    expect(gateway.replaceRoles).toHaveBeenCalledWith(userId, [
      roleOne,
      roleTwo,
    ]);
    expect(events.map((event) => event.action)).toEqual([
      "user.roles_assignment_requested",
      "user.roles_assigned",
    ]);
    expect(events[1]).toMatchObject({
      previousValues: { roleIds: [roleOne] },
      newValues: { roleIds: [roleOne, roleTwo] },
    });
  });

  it.each([
    ["empty roles", []],
    ["duplicate roles", [roleOne, roleOne]],
    ["malformed role", ["not-a-uuid"]],
  ] as const)(
    "rejects %s before audit or mutation",
    async (_label, roleIds) => {
      const { service, gateway, events } = setup();

      const result = await service.replaceRoles(actorId, {
        userId,
        roleIds,
      });

      expect(result.ok).toBe(false);
      expect(gateway.replaceRoles).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    },
  );

  it("does not mutate when the durable audit intent fails", async () => {
    const append = vi.fn().mockRejectedValue(new Error("audit unavailable"));
    const { service, gateway } = setup(append);

    const result = await service.replaceRoles(actorId, {
      userId,
      roleIds: [roleOne],
    });

    expect(result.ok).toBe(false);
    expect(gateway.replaceRoles).not.toHaveBeenCalled();
  });

  it("retains intent and records a sanitized failure outcome", async () => {
    const { service, gateway, events } = setup();
    vi.mocked(gateway.replaceRoles).mockRejectedValueOnce(
      new Error("database internals"),
    );

    const result = await service.replaceRoles(actorId, {
      userId,
      roleIds: [roleOne],
    });

    expect(result.ok).toBe(false);
    expect(events.map((event) => event.action)).toEqual([
      "user.roles_assignment_requested",
      "user.roles_assignment_failed",
    ]);
    expect(JSON.stringify(events)).not.toContain("database internals");
  });
});
