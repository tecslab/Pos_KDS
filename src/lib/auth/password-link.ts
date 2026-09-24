export const PASSWORD_LINK_MODES = ["invite", "recovery"] as const;

export type PasswordLinkMode = (typeof PASSWORD_LINK_MODES)[number];
export type PasswordLinkAuthEvent = "SIGNED_IN" | "PASSWORD_RECOVERY";

export type PasswordLinkClaims = Readonly<{
  userId: string;
  sessionId: string;
  mode: PasswordLinkMode;
  issuedAt: number;
  expiresAt: number;
}>;

export type PasswordLinkMarkerVerifier = (
  marker: string,
) => PasswordLinkClaims | null;

type VerifiedSessionService = Readonly<{
  getUser(): Promise<{
    data: { user: { id?: unknown } | null } | null;
    error: unknown | null;
  }>;
  getClaims(): Promise<{
    data: { claims: { sub?: unknown; session_id?: unknown } } | null;
    error: unknown | null;
  }>;
}>;

type PasswordUpdateService = VerifiedSessionService &
  Readonly<{
    updateUser(input: { password: string }): Promise<{ error: unknown | null }>;
  }>;

type ImplicitSession = Readonly<{
  access_token?: unknown;
  user?: { id?: unknown } | null;
}>;

export type ImplicitPasswordLinkAuth = Readonly<{
  onAuthStateChange(
    callback: (event: string, session: ImplicitSession | null) => void,
  ): { data: { subscription: { unsubscribe(): void } } };
  getSession(): Promise<{
    data: { session: ImplicitSession | null };
    error: unknown | null;
  }>;
}>;

export type ImplicitPasswordLinkClassification = Readonly<{
  mode: PasswordLinkMode;
  expectedEvent: PasswordLinkAuthEvent;
}>;

export type ImplicitPasswordLinkResult = Readonly<{
  code: "ready" | "missing" | "expired_or_invalid" | "unusable";
  mode: PasswordLinkMode | null;
}>;

export type PasswordLinkUpdateResult = Readonly<{
  code: "invalid_password" | "unusable" | "update_failed" | "updated";
}>;

const ACCEPT_PATH = "/auth/accept-invite";
const REQUIRED_FRAGMENT_FIELDS = [
  "access_token",
  "refresh_token",
  "expires_in",
  "token_type",
  "type",
] as const;

export function classifyImplicitPasswordLink(
  url: URL,
): ImplicitPasswordLinkClassification | null {
  if (url.pathname !== ACCEPT_PATH) return null;
  const modes = url.searchParams.getAll("mode");
  if (modes.length !== 1) return null;
  const mode = parsePasswordLinkMode(modes[0]);
  if (mode === null) return null;

  for (const field of REQUIRED_FRAGMENT_FIELDS) {
    if (url.searchParams.has(field)) return null;
  }

  const fragment = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : "",
  );
  for (const field of REQUIRED_FRAGMENT_FIELDS) {
    const values = fragment.getAll(field);
    if (values.length !== 1 || values[0].trim().length === 0) return null;
  }
  if (fragment.getAll("expires_at").length > 1) return null;
  if (fragment.get("token_type")?.toLowerCase() !== "bearer") return null;
  if (!/^\d+$/.test(fragment.get("expires_in") ?? "")) return null;

  const type = fragment.get("type");
  if (mode === "invite" && type === "invite") {
    return Object.freeze({ mode, expectedEvent: "SIGNED_IN" });
  }
  if (mode === "recovery" && type === "recovery") {
    return Object.freeze({ mode, expectedEvent: "PASSWORD_RECOVERY" });
  }
  return null;
}

export async function consumeImplicitPasswordLink(
  classification: ImplicitPasswordLinkClassification | null,
  auth: ImplicitPasswordLinkAuth,
  dependencies: Readonly<{
    bootstrap(accessToken: string, mode: PasswordLinkMode): Promise<boolean>;
    scrubFragment(): void;
    timeoutMilliseconds?: number;
  }>,
): Promise<ImplicitPasswordLinkResult> {
  if (classification === null) {
    dependencies.scrubFragment();
    return Object.freeze({ code: "missing", mode: null });
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let resolveEvent: ((session: ImplicitSession | null) => void) | undefined;
  const matchingEvent = new Promise<ImplicitSession | null>((resolve) => {
    resolveEvent = resolve;
    timeout = setTimeout(
      () => resolve(null),
      dependencies.timeoutMilliseconds ?? 5000,
    );
  });
  const { data } = auth.onAuthStateChange((event, session) => {
    if (event === classification.expectedEvent) resolveEvent?.(session);
  });

  try {
    const [sessionResult, eventSession] = await Promise.all([
      auth.getSession(),
      matchingEvent,
    ]);
    const storedSession = sessionResult.data.session;
    const accessToken = storedSession?.access_token;
    const storedUserId = storedSession?.user?.id;
    const eventUserId = eventSession?.user?.id;
    if (
      sessionResult.error !== null ||
      typeof accessToken !== "string" ||
      accessToken.length === 0 ||
      !isUuid(storedUserId) ||
      eventUserId !== storedUserId ||
      eventSession?.access_token !== accessToken
    ) {
      return Object.freeze({
        code: "expired_or_invalid",
        mode: classification.mode,
      });
    }

    dependencies.scrubFragment();
    const bootstrapped = await dependencies.bootstrap(
      accessToken,
      classification.mode,
    );
    return Object.freeze({
      code: bootstrapped ? "ready" : "unusable",
      mode: classification.mode,
    });
  } catch {
    return Object.freeze({
      code: "expired_or_invalid",
      mode: classification.mode,
    });
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    data.subscription.unsubscribe();
    dependencies.scrubFragment();
  }
}

export async function validatePasswordLinkSession(
  marker: string | null,
  verifyMarker: PasswordLinkMarkerVerifier,
  service: VerifiedSessionService,
): Promise<PasswordLinkClaims | null> {
  if (marker === null) return null;
  const claims = verifyMarker(marker);
  if (claims === null) return null;

  try {
    const [userResult, claimsResult] = await Promise.all([
      service.getUser(),
      service.getClaims(),
    ]);
    const userId = userResult.data?.user?.id;
    const sessionClaims = claimsResult.data?.claims;
    return userResult.error === null &&
      claimsResult.error === null &&
      userId === claims.userId &&
      sessionClaims?.sub === claims.userId &&
      sessionClaims.session_id === claims.sessionId
      ? claims
      : null;
  } catch {
    return null;
  }
}

export async function updatePasswordFromLink(
  input: Readonly<{ marker: string | null; password: string | null }>,
  verifyMarker: PasswordLinkMarkerVerifier,
  service: PasswordUpdateService,
): Promise<PasswordLinkUpdateResult> {
  if (input.marker === null || verifyMarker(input.marker) === null) {
    return Object.freeze({ code: "unusable" });
  }
  if (input.password === null || input.password.length < 8) {
    return Object.freeze({ code: "invalid_password" });
  }

  const claims = await validatePasswordLinkSession(
    input.marker,
    verifyMarker,
    service,
  );
  if (claims === null) return Object.freeze({ code: "unusable" });

  try {
    const { error } = await service.updateUser({ password: input.password });
    return Object.freeze({
      code: error === null ? "updated" : "update_failed",
    });
  } catch {
    return Object.freeze({ code: "update_failed" });
  }
}

export function parsePasswordLinkMode(value: unknown): PasswordLinkMode | null {
  return value === "invite" || value === "recovery" ? value : null;
}

export function buildPasswordLinkCallbackUrl(
  requestOrigin: string | null,
  mode: PasswordLinkMode,
): string | null {
  if (requestOrigin === null) return null;
  try {
    const origin = new URL(requestOrigin);
    if (
      (origin.protocol !== "https:" && origin.protocol !== "http:") ||
      origin.username !== "" ||
      origin.password !== "" ||
      origin.origin !== requestOrigin
    ) {
      return null;
    }
    const callback = new URL(ACCEPT_PATH, origin);
    callback.searchParams.set("mode", mode);
    return callback.toString();
  } catch {
    return null;
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
