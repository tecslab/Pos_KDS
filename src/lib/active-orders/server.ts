import "server-only";

import { ActiveOrderQueryService } from "../../application";
import { SupabaseActiveOrderReader } from "../../infrastructure/orders";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createActiveOrderQueryService() {
  return new ActiveOrderQueryService(
    new SupabaseActiveOrderReader(createSupabaseAdminClient()),
  );
}
