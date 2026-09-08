import "server-only";

import { InventoryViewsService } from "../../application";
import { SupabaseInventoryViewsReader } from "../../infrastructure/inventory";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createInventoryViewsService() {
  return new InventoryViewsService(
    new SupabaseInventoryViewsReader(createSupabaseAdminClient()),
  );
}
