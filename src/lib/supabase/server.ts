import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicEnvironment } from "../config/runtime";
import { assertTlsVerificationEnabled } from "../config/tls-security";

export async function createServerSupabaseClient() {
  assertTlsVerificationEnabled(process.env.NODE_TLS_REJECT_UNAUTHORIZED);
  const cookieStore = await cookies();

  return createServerClient(
    publicEnvironment.supabaseUrl,
    publicEnvironment.supabasePublishableKey,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies. The proxy refreshes them.
          }
        },
      },
    },
  );
}
