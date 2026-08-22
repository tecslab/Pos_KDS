const SECRET_KEY_PREFIX = "sb_secret_";

export type ServerEnvironmentSource = Readonly<{
  SUPABASE_SECRET_KEY?: string;
}>;

export type ServerEnvironment = Readonly<{
  supabaseSecretKey: string;
}>;

export function parseServerEnvironment(
  source: ServerEnvironmentSource,
): ServerEnvironment {
  const secretKey = source.SUPABASE_SECRET_KEY?.trim();

  if (!secretKey || !secretKey.startsWith(SECRET_KEY_PREFIX)) {
    throw new Error(
      "SUPABASE_SECRET_KEY is required and must be a modern Supabase secret key.",
    );
  }

  return Object.freeze({ supabaseSecretKey: secretKey });
}
