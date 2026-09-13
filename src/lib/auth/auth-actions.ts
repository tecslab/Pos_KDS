import { safeLocalPath } from "./auth-paths";
import {
  NoOpOperationalTelemetryRecorder,
  type OperationalTelemetryRecorder,
} from "../../application";

export type PasswordSignInService = Readonly<{
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<{ error: unknown | null }>;
}>;

export type SignOutService = Readonly<{
  signOut(options: { scope: "local" }): Promise<{ error: unknown | null }>;
}>;

export type SignInActionResult = Readonly<{
  ok: boolean;
  nextPath: string;
}>;

/** Delegates credentials to Supabase without persisting, returning, or logging them. */
export async function authenticatePassword(
  formData: FormData,
  service: PasswordSignInService,
  telemetry: OperationalTelemetryRecorder = new NoOpOperationalTelemetryRecorder(),
): Promise<SignInActionResult> {
  const nextPath = safeLocalPath(formData.get("next"));
  const email = formValue(formData.get("email"));
  const password = formValue(formData.get("password"));

  if (email === null || password === null) {
    recordAuthFailure(telemetry, "MISSING_OR_INVALID_SESSION");
    return Object.freeze({ ok: false, nextPath });
  }

  try {
    const { error } = await service.signInWithPassword({ email, password });
    if (error !== null) recordAuthFailure(telemetry, "PROVIDER_FAILURE");
    return Object.freeze({ ok: error === null, nextPath });
  } catch {
    recordAuthFailure(telemetry, "PROVIDER_FAILURE");
    return Object.freeze({ ok: false, nextPath });
  }
}

function recordAuthFailure(
  telemetry: OperationalTelemetryRecorder,
  reason: "MISSING_OR_INVALID_SESSION" | "PROVIDER_FAILURE",
): void {
  try {
    telemetry.record({ event: "authentication.failed", reason });
  } catch {
    // Authentication behavior is independent from operational telemetry.
  }
}

export async function endLocalSession(
  service: SignOutService,
): Promise<boolean> {
  try {
    const { error } = await service.signOut({ scope: "local" });
    return error === null;
  } catch {
    return false;
  }
}

function formValue(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
