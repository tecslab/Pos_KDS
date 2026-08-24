import "server-only";

import { randomUUID } from "node:crypto";

import {
  AuditEventService,
  ProductCategoryAdministrationService,
} from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseProductCategoryAdministrationGateway } from "../../infrastructure/configuration";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createProductCategoryAdministrationService() {
  const adapter = new SupabaseProductCategoryAdministrationGateway(
    createSupabaseAdminClient(),
  );
  return new ProductCategoryAdministrationService(
    adapter,
    new AuditEventService(adapter, new SystemAuditClock()),
    randomUUID,
  );
}
