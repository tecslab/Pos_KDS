"use client";

import { createBrowserClient } from "@supabase/ssr";

import { publicEnvironment } from "../config/runtime";

export function createBrowserSupabaseClient() {
  return createBrowserClient(
    publicEnvironment.supabaseUrl,
    publicEnvironment.supabasePublishableKey,
  );
}
