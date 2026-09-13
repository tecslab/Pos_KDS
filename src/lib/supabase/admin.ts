import "server-only";

import { createClient } from "@supabase/supabase-js";

import { publicEnvironment } from "../config/runtime";
import { serverEnvironment } from "../config/server-runtime";
import { assertTlsVerificationEnabled } from "../config/tls-security";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../observability/recorder";
import { instrumentSupabaseDatabaseClient } from "../../infrastructure/observability";

export function createSupabaseAdminClient() {
  assertTlsVerificationEnabled(process.env.NODE_TLS_REJECT_UNAUTHORIZED);
  const client = createClient(
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

  return instrumentSupabaseDatabaseClient(
    client,
    operationalTelemetry,
    operationalTelemetryClock,
  );
}
