import type { SupabaseClient } from "@supabase/supabase-js";

/** SDK-facing client surface kept inside the infrastructure boundary. */
export type SupabaseRealtimeClient = Pick<
  SupabaseClient,
  "channel" | "getChannels" | "removeChannel"
>;
