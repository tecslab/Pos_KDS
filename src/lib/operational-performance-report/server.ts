import "server-only";

import { OperationalPerformanceReportService } from "../../application";
import { SupabaseOperationalPerformanceReportReader } from "../../infrastructure/reports";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createOperationalPerformanceReportService() {
  return new OperationalPerformanceReportService(
    new SupabaseOperationalPerformanceReportReader(createSupabaseAdminClient()),
  );
}
