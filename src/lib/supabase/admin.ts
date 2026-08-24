import "server-only";

import { createClient } from "@supabase/supabase-js";

import { publicEnvironment } from "../config/runtime";
import { serverEnvironment } from "../config/server-runtime";
import { assertTlsVerificationEnabled } from "../config/tls-security";

export function createSupabaseAdminClient() {
  assertTlsVerificationEnabled(process.env.NODE_TLS_REJECT_UNAUTHORIZED);
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
