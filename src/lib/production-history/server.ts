import "server-only";

import { ProductionHistoryService } from "../../application";
import { SupabaseProductionHistoryReader } from "../../infrastructure/production";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createProductionHistoryService() {
  return new ProductionHistoryService(
    new SupabaseProductionHistoryReader(createSupabaseAdminClient()),
  );
}
