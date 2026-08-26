import "server-only";

import { PosOrderingContextService } from "../../application";
import { SupabasePosOrderingContextReader } from "../../infrastructure/configuration";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createPosOrderingContextService() {
  return new PosOrderingContextService(
    new SupabasePosOrderingContextReader(createSupabaseAdminClient()),
  );
}
