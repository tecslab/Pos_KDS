import "server-only";

import { createClient } from "@supabase/supabase-js";

import { publicEnvironment } from "../config/runtime";
import { serverEnvironment } from "../config/server-runtime";

export function createSupabaseAdminClient() {
  return createClient(
    publicEnvironment.supabaseUrl,
    serverEnvironment.supabaseSecretKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}
