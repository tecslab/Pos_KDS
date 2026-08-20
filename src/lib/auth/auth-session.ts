export type VerifiedSession = Readonly<{
  userId: string;
  email: string | null;
}>;

export type ClaimsResult = Readonly<{
  data: Readonly<{
    claims: Readonly<{
      sub?: unknown;
      email?: unknown;
    }>;
  }> | null;
  error: unknown | null;
}>;

export interface ClaimsAuthClient {
  auth: Readonly<{
    getClaims(): Promise<ClaimsResult>;
  }>;
}

/** Establishes identity only from Supabase-verified JWT claims. */
export async function readVerifiedSession(
  client: ClaimsAuthClient,
): Promise<VerifiedSession | null> {
  try {
    const { data, error } = await client.auth.getClaims();
    const claims = data?.claims;
    const subject = claims?.sub;
    const email = claims?.email;

    if (error !== null || !isNonblank(subject)) {
      return null;
    }

    return Object.freeze({
      userId: subject,
      email: isNonblank(email) ? email : null,
    });
  } catch {
    return null;
  }
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
