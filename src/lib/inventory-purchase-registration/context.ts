import "server-only";

import { InventoryPurchaseContextService } from "../../application";
import { SupabaseInventoryPurchaseContextReader } from "../../infrastructure/inventory";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createInventoryPurchaseContextService() {
  return new InventoryPurchaseContextService(
    new SupabaseInventoryPurchaseContextReader(createSupabaseAdminClient()),
  );
}
