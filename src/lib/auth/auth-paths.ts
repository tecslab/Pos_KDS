export const LOGIN_PATH = "/login";
export const DEFAULT_AUTHENTICATED_PATH = "/";

const LOCAL_ORIGIN = "https://carnales.local";

export function safeLocalPath(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  const candidate = value.trim();

  if (
    candidate.length === 0 ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  try {
    const url = new URL(candidate, LOCAL_ORIGIN);

    return url.origin === LOCAL_ORIGIN && url.pathname !== LOGIN_PATH
      ? `${url.pathname}${url.search}${url.hash}`
      : DEFAULT_AUTHENTICATED_PATH;
  } catch {
    return DEFAULT_AUTHENTICATED_PATH;
  }
}

export function loginPath(nextPath: unknown, failed = false): string {
  const query = new URLSearchParams();
  const safeNextPath = safeLocalPath(nextPath);

  if (safeNextPath !== DEFAULT_AUTHENTICATED_PATH) {
    query.set("next", safeNextPath);
  }

  if (failed) {
    query.set("error", "authentication_failed");
  }

  const suffix = query.toString();
  return suffix.length > 0 ? `${LOGIN_PATH}?${suffix}` : LOGIN_PATH;
}
