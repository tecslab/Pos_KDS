import "server-only";

import { InventoryProductionExpenseReportService } from "../../application";
import { SupabaseInventoryProductionExpenseReportReader } from "../../infrastructure/reports";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createInventoryProductionExpenseReportService() {
  return new InventoryProductionExpenseReportService(
    new SupabaseInventoryProductionExpenseReportReader(
      createSupabaseAdminClient(),
    ),
  );
}
