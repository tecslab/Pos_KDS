import "server-only";

import { AuditEventService, OperatingSettingsService } from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseOperatingSettingsGateway } from "../../infrastructure/configuration";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createOperatingSettingsService() {
  const adapter = new SupabaseOperatingSettingsGateway(
    createSupabaseAdminClient(),
  );
  return new OperatingSettingsService(
    adapter,
    new AuditEventService(adapter, new SystemAuditClock()),
  );
}
