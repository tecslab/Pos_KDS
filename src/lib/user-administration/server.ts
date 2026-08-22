import "server-only";

import {
  AuditEventService,
  UserAdministrationService,
} from "../../application";
import {
  SupabaseAuditEventAppender,
  SystemAuditClock,
} from "../../infrastructure/audit";
import { SupabaseUserAdministrationGateway } from "../../infrastructure/auth";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createUserAdministrationService() {
  const client = createSupabaseAdminClient();
  return new UserAdministrationService(
    new SupabaseUserAdministrationGateway(client),
    new AuditEventService(
      new SupabaseAuditEventAppender(client),
      new SystemAuditClock(),
    ),
  );
}
