import "server-only";

import { randomUUID } from "node:crypto";

import {
  AuditEventService,
  ProductAdministrationService,
} from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseProductAdministrationGateway } from "../../infrastructure/configuration";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createProductAdministrationService() {
  const adapter = new SupabaseProductAdministrationGateway(
    createSupabaseAdminClient(),
  );
  return new ProductAdministrationService(
    adapter,
    new AuditEventService(adapter, new SystemAuditClock()),
    randomUUID,
  );
}
