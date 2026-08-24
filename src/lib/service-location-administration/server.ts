import "server-only";
import { randomUUID } from "node:crypto";

import {
  AuditEventService,
  ServiceLocationAdministrationService,
} from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseServiceLocationAdministrationGateway } from "../../infrastructure/configuration";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createServiceLocationAdministrationService() {
  const adapter = new SupabaseServiceLocationAdministrationGateway(
    createSupabaseAdminClient(),
  );
  return new ServiceLocationAdministrationService(
    adapter,
    new AuditEventService(adapter, new SystemAuditClock()),
    randomUUID,
  );
}
