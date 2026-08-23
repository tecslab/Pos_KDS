import "server-only";

import {
  AuditEventService,
  RoleAdministrationService,
} from "../../application";
import {
  SupabaseAuditEventAppender,
  SystemAuditClock,
} from "../../infrastructure/audit";
import { SupabaseRoleAdministrationGateway } from "../../infrastructure/auth";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createRoleAdministrationService() {
  const client = createSupabaseAdminClient();
  return new RoleAdministrationService(
    new SupabaseRoleAdministrationGateway(client),
    new AuditEventService(
      new SupabaseAuditEventAppender(client),
      new SystemAuditClock(),
    ),
  );
}
