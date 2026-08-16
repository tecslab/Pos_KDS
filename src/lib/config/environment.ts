const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";

export type PublicEnvironmentSource = Readonly<{
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
}>;

export type PublicEnvironment = Readonly<{
  supabaseUrl: string;
  supabasePublishableKey: string;
}>;

export class EnvironmentConfigurationError extends Error {
  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n- ${issues.join("\n- ")}`);
    this.name = "EnvironmentConfigurationError";
  }
}

const readRequiredValue = (
  value: string | undefined,
  field: keyof PublicEnvironmentSource,
  issues: string[],
): string | undefined => {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    issues.push(`${field} is required and must not be blank`);
    return undefined;
  }

  return normalizedValue;
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export const parsePublicEnvironment = (
  source: PublicEnvironmentSource,
): PublicEnvironment => {
  const issues: string[] = [];
  const supabaseUrl = readRequiredValue(
    source.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL",
    issues,
  );
  const supabasePublishableKey = readRequiredValue(
    source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    issues,
  );

  if (supabaseUrl && !isHttpUrl(supabaseUrl)) {
    issues.push("NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP(S) URL");
  }

  if (
    supabasePublishableKey &&
    (supabasePublishableKey === PUBLISHABLE_KEY_PREFIX ||
      !supabasePublishableKey.startsWith(PUBLISHABLE_KEY_PREFIX))
  ) {
    issues.push(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a modern Supabase publishable key",
    );
  }

  if (issues.length > 0) {
    throw new EnvironmentConfigurationError(issues);
  }

  return Object.freeze({
    supabaseUrl: supabaseUrl as string,
    supabasePublishableKey: supabasePublishableKey as string,
  });
};
