import "server-only";

import { PaymentReportService } from "../../application";
import { SupabasePaymentReportReader } from "../../infrastructure/reports";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createPaymentReportService() {
  return new PaymentReportService(
    new SupabasePaymentReportReader(createSupabaseAdminClient()),
  );
}
