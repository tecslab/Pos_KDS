import "server-only";

import { DailySalesReportService } from "../../application";
import { SupabaseDailySalesReportReader } from "../../infrastructure/reports";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createDailySalesReportService() {
  return new DailySalesReportService(
    new SupabaseDailySalesReportReader(createSupabaseAdminClient()),
  );
}
