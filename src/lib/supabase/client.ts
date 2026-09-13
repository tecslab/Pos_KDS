"use client";

import { createBrowserClient } from "@supabase/ssr";

import { publicEnvironment } from "../config/runtime";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../observability/recorder";
import { instrumentSupabaseDatabaseClient } from "../../infrastructure/observability";

export function createBrowserSupabaseClient() {
  const client = createBrowserClient(
    publicEnvironment.supabaseUrl,
    publicEnvironment.supabasePublishableKey,
  );

  return instrumentSupabaseDatabaseClient(
    client,
    operationalTelemetry,
    operationalTelemetryClock,
  );
}
