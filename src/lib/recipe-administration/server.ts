import "server-only";

import { randomUUID } from "node:crypto";

import {
  AuditEventService,
  RecipeAdministrationService,
} from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseRecipeAdministrationGateway } from "../../infrastructure/production";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createRecipeAdministrationService() {
  const adapter = new SupabaseRecipeAdministrationGateway(
    createSupabaseAdminClient(),
  );
  return new RecipeAdministrationService(
    adapter,
    new AuditEventService(adapter, new SystemAuditClock()),
    randomUUID,
  );
}
