import "server-only";

import { PaymentQueryService } from "../../application";
import { SupabasePaymentQueryReader } from "../../infrastructure/payments";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createPaymentQueryService() {
  return new PaymentQueryService(
    new SupabasePaymentQueryReader(createSupabaseAdminClient()),
  );
}
