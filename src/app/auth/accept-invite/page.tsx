import Image from "next/image";
import { cookies } from "next/headers";

import carnalesLogo from "../../../../carnalesComp.png";
import {
  parsePasswordLinkMode,
  validatePasswordLinkSession,
} from "@/lib/auth/password-link";
import {
  PASSWORD_LINK_MARKER_COOKIE,
  verifyPasswordLinkMarker,
} from "@/lib/auth/password-link-marker";
import { serverEnvironment } from "@/lib/config/server-runtime";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { updatePassword } from "./actions";
import { PasswordLinkController } from "./password-link-controller";
import { PasswordSubmitButton } from "./password-submit-button";

type PageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;

export default async function AcceptInvitePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const marker = cookieStore.get(PASSWORD_LINK_MARKER_COOKIE)?.value ?? null;
  const client = await createServerSupabaseClient();
  const claims = await validatePasswordLinkSession(
    marker,
    (value) =>
      verifyPasswordLinkMarker(value, serverEnvironment.supabaseSecretKey),
    client.auth,
  );
  const mode = claims?.mode ?? parsePasswordLinkMode(first(params.mode));
  const status = first(params.status);
  const ready = claims !== null;
  const feedback =
    ready && status === "invalid_password"
      ? "La contraseña debe tener al menos 8 caracteres."
      : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4 py-8 text-[var(--color-text)]">
      <section className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-md)]">
        <Image
          src={carnalesLogo}
          alt="Carnales"
          className="mx-auto h-auto w-44"
          priority
        />
        <div className="mt-8">
          <h1 className="text-2xl font-bold">Configura tu contraseña</h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            {ready
              ? "Define una contraseña para continuar con tu cuenta."
              : "Necesitas un enlace válido para configurar tu contraseña."}
          </p>
        </div>

        {ready && feedback ? (
          <p
            role="alert"
            className="mt-5 rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-3 text-sm text-[var(--status-critical)]"
          >
            {feedback}
          </p>
        ) : null}

        {!ready ? (
          <PasswordLinkController
            initialMode={mode}
            initialStatus={status ?? (marker !== null ? "unusable" : undefined)}
          />
        ) : null}

        {ready ? (
          <form action={updatePassword} className="mt-6 space-y-5">
            <label className="block text-sm font-semibold">
              Contraseña nueva
              <input
                className="mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] bg-white px-3 text-base outline-none focus:border-[var(--brand-green)] focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <PasswordSubmitButton />
          </form>
        ) : null}
      </section>
    </main>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
