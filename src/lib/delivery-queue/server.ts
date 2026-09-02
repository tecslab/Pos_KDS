import "server-only";

import { DeliveryQueueService } from "../../application";
import { SupabaseDeliveryQueueReader } from "../../infrastructure/orders";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createDeliveryQueueService() {
  return new DeliveryQueueService(
    new SupabaseDeliveryQueueReader(createSupabaseAdminClient()),
  );
}
