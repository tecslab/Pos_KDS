import { describe, expect, it, vi } from "vitest";

import { AuditEventService, type AuditEventRecord } from "../audit";
import {
  UserAdministrationService,
  type ManagedUser,
  type UserAdministrationGateway,
} from "./user-administration";

const actorId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const user: ManagedUser = Object.freeze({
  id: userId,
  email: "user@example.com",
  displayName: "Usuario Ejemplo",
  state: "ACTIVE",
  roleNames: Object.freeze(["Waiter"]),
  invitedAt: "2026-08-22T12:00:00.000Z",
  lastSignInAt: null,
});

function setup(appendOverride?: (event: AuditEventRecord) => Promise<void>) {
  const gateway: UserAdministrationGateway = {
    listUsers: vi.fn().mockResolvedValue([user]),
    inviteUser: vi.fn().mockResolvedValue({
      id: userId,
      email: "new@example.com",
      displayName: "Nueva Persona",
    }),
    setUserActive: vi.fn().mockImplementation(async (_id, active) => ({
      ...user,
      state: active ? "ACTIVE" : "INACTIVE",
    })),
    sendPasswordReset: vi.fn().mockResolvedValue(user),
  };
  const appended: AuditEventRecord[] = [];
  const append =
    appendOverride ??
    (async (event: AuditEventRecord) => void appended.push(event));
  const audit = new AuditEventService(
    { append },
    { now: () => new Date("2026-08-22T15:00:00.000Z") },
  );
  return {
    gateway,
    appended,
    service: new UserAdministrationService(gateway, audit),
  };
}

describe("UserAdministrationService", () => {
  it("normalizes an invitation and records an immutable audit snapshot", async () => {
    const { service, gateway, appended } = setup();

    const result = await service.invite(actorId, {
      email: "  NEW@Example.COM ",
      displayName: "  Nueva   Persona ",
    });

    expect(result.ok).toBe(true);
    expect(gateway.inviteUser).toHaveBeenCalledWith(
      "new@example.com",
      "Nueva Persona",
    );
    expect(appended).toHaveLength(2);
    expect(appended[0]).toMatchObject({
      action: "user.invitation_requested",
      entityId: "email:new@example.com",
    });
    expect(appended[1]).toMatchObject({
      actorId,
      action: "user.invited",
      entityId: userId,
      previousValues: null,
      newValues: {
        email: "new@example.com",
        displayName: "Nueva Persona",
      },
    });
    expect(JSON.stringify(appended)).not.toMatch(/password|token/i);
    expect(Object.isFrozen(appended[1])).toBe(true);
  });

  it("rejects malformed invitation input before any side effect", async () => {
    const { service, gateway, appended } = setup();

    const result = await service.invite(actorId, {
      email: "not-an-email",
      displayName: "X",
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "user-administration-error", code: "INVALID_INPUT" },
    });
    expect(gateway.inviteUser).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
  });

  it.each([
    [true, "user.activated"],
    [false, "user.deactivated"],
  ] as const)("audits an activation transition", async (active, action) => {
    const { service, gateway, appended } = setup();

    const result = await service.setActive(actorId, userId, active);

    expect(result.ok).toBe(true);
    expect(gateway.setUserActive).toHaveBeenCalledWith(userId, active);
    expect(appended[0]?.action).toBe(
      active ? "user.activation_requested" : "user.deactivation_requested",
    );
    expect(appended[1]).toMatchObject({
      action,
      previousValues: { isActive: !active },
      newValues: { isActive: active },
    });
  });

  it("initiates a reset without handling a password, token, or secret", async () => {
    const { service, gateway, appended } = setup();

    const result = await service.requestPasswordReset(actorId, userId);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(gateway.sendPasswordReset).toHaveBeenCalledWith(userId);
    expect(appended[0]).toMatchObject({
      action: "user.password_reset_requested",
      entityId: userId,
      previousValues: null,
      newValues: null,
    });
    expect(appended[1]?.action).toBe("user.password_reset_dispatched");
    expect(
      JSON.stringify({
        previousValues: appended[0]?.previousValues,
        newValues: appended[0]?.newValues,
      }),
    ).not.toMatch(/password|token|secret/i);
  });

  it("passes a validated recovery callback while preserving reset audits", async () => {
    const { service, gateway, appended } = setup();
    const redirectTo =
      "https://carnales.example/auth/accept-invite?mode=recovery";

    const result = await service.requestPasswordReset(
      actorId,
      userId,
      redirectTo,
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(gateway.sendPasswordReset).toHaveBeenCalledWith(userId, redirectTo);
    expect(appended.map((event) => event.action)).toEqual([
      "user.password_reset_requested",
      "user.password_reset_dispatched",
    ]);
  });

  it("rejects a malformed recovery callback before dispatch", async () => {
    const { service, gateway, appended } = setup();

    const result = await service.requestPasswordReset(
      actorId,
      userId,
      "javascript:unsafe",
    );

    expect(result).toEqual({
      ok: false,
      error: { kind: "user-administration-error", code: "INVALID_INPUT" },
    });
    expect(gateway.sendPasswordReset).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
  });

  it("returns a sanitized failure when infrastructure rejects", async () => {
    const { service, gateway } = setup();
    vi.mocked(gateway.listUsers).mockRejectedValueOnce(
      new Error("provider token must never escape"),
    );

    await expect(service.list()).resolves.toEqual({
      ok: false,
      error: { kind: "user-administration-error", code: "OPERATION_FAILED" },
    });
  });

  it.each(["invite", "activation", "reset"] as const)(
    "does not perform %s when its durable audit intent cannot be stored",
    async (operation) => {
      const append = vi.fn().mockRejectedValue(new Error("audit unavailable"));
      const { service, gateway } = setup(append);

      const result =
        operation === "invite"
          ? await service.invite(actorId, {
              email: "new@example.com",
              displayName: "Nueva Persona",
            })
          : operation === "activation"
            ? await service.setActive(actorId, userId, false)
            : await service.requestPasswordReset(actorId, userId);

      expect(result.ok).toBe(false);
      expect(gateway.inviteUser).not.toHaveBeenCalled();
      expect(gateway.setUserActive).not.toHaveBeenCalled();
      expect(gateway.sendPasswordReset).not.toHaveBeenCalled();
    },
  );

  it("retains the durable intent and records a sanitized failed outcome", async () => {
    const { service, gateway, appended } = setup();
    vi.mocked(gateway.setUserActive).mockRejectedValueOnce(
      new Error("provider credential detail"),
    );

    const result = await service.setActive(actorId, userId, false);

    expect(result.ok).toBe(false);
    expect(appended.map((event) => event.action)).toEqual([
      "user.deactivation_requested",
      "user.deactivation_failed",
    ]);
    expect(JSON.stringify(appended)).not.toContain(
      "provider credential detail",
    );
  });
});
