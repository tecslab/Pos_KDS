import "server-only";

import { KitchenQueueService } from "../../application";
import { SupabaseKitchenQueueReader } from "../../infrastructure/orders";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createKitchenQueueService() {
  return new KitchenQueueService(
    new SupabaseKitchenQueueReader(createSupabaseAdminClient()),
  );
}
