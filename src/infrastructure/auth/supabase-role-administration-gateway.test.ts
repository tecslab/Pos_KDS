import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { SupabaseRoleAdministrationGateway } from "./supabase-role-administration-gateway";

const userId = "20000000-0000-4000-8000-000000000001";
const roleId = "30000000-0000-4000-8000-000000000001";

describe("SupabaseRoleAdministrationGateway", () => {
  it("invokes only the atomic role replacement RPC with role identifiers", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ previous_role_ids: [], assigned_role_ids: [roleId] }],
      error: null,
    });
    const gateway = new SupabaseRoleAdministrationGateway({
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: userId,
                email: "person@example.com",
                user_metadata: { display_name: "Persona" },
              },
            },
            error: null,
          }),
        },
      },
      rpc,
    } as unknown as SupabaseClient);

    const result = await gateway.replaceRoles(userId, [roleId]);

    expect(rpc).toHaveBeenCalledWith("replace_application_user_roles", {
      target_user_id: userId,
      target_display_name: "Persona",
      desired_role_ids: [roleId],
    });
    expect(result).toEqual({ previousRoleIds: [], assignedRoleIds: [roleId] });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/permission/i);
  });

  it("maps role permissions for inspection without exposing mutation methods", async () => {
    const select = vi.fn().mockResolvedValue({
      data: [
        {
          id: roleId,
          code: "waiter",
          name: "Waiter",
          description: null,
          role_permissions: [
            {
              permission: {
                code: "orders.create",
                name: "Create Orders",
                description: null,
              },
            },
          ],
        },
      ],
      error: null,
    });
    const from = vi.fn().mockReturnValue({ select });
    const gateway = new SupabaseRoleAdministrationGateway({
      from,
    } as unknown as SupabaseClient);

    await expect(gateway.listRoles()).resolves.toEqual([
      expect.objectContaining({
        id: roleId,
        code: "waiter",
        permissions: [expect.objectContaining({ code: "orders.create" })],
      }),
    ]);
    expect(from).toHaveBeenCalledWith("roles");
  });

  it("merges pending Auth users with persisted role assignments", async () => {
    const authUsers = [
      {
        id: userId,
        email: "person@example.com",
        user_metadata: { display_name: "Persona" },
      },
    ];
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    const client = {
      auth: {
        admin: {
          listUsers: vi
            .fn()
            .mockResolvedValue({ data: { users: authUsers }, error: null }),
        },
      },
      from,
    } as unknown as SupabaseClient;
    const gateway = new SupabaseRoleAdministrationGateway(client);

    await expect(gateway.listEmployees()).resolves.toEqual([
      expect.objectContaining({
        id: userId,
        roleIds: [],
        displayName: "Persona",
      }),
    ]);
  });
});
