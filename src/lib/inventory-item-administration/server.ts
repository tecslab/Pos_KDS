import "server-only";

import { randomUUID } from "node:crypto";

import {
  AuditEventService,
  InventoryItemAdministrationService,
} from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseInventoryItemAdministrationGateway } from "../../infrastructure/configuration";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createInventoryItemAdministrationService() {
  const adapter = new SupabaseInventoryItemAdministrationGateway(
    createSupabaseAdminClient(),
  );
  return new InventoryItemAdministrationService(
    adapter,
    new AuditEventService(adapter, new SystemAuditClock()),
    randomUUID,
  );
}
