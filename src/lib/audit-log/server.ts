import "server-only";

import { AuditLogService } from "../../application";
import { SupabaseAuditLogReader } from "../../infrastructure/audit";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createAuditLogService() {
  return new AuditLogService(
    new SupabaseAuditLogReader(createSupabaseAdminClient()),
  );
}
