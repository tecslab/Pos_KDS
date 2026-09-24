import Image from "next/image";

import carnalesLogo from "../../../carnalesComp.png";
import { safeLocalPath } from "@/lib/auth";

import { signIn } from "./actions";

type LoginPageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = safeLocalPath(first(params.next));
  const showError = first(params.error) === "authentication_failed";
  const passwordUpdated = first(params.status) === "password_updated";

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
          <h1 className="text-2xl font-bold">Iniciar sesión</h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Ingresa con tu cuenta de empleado.
          </p>
        </div>

        {showError ? (
          <p
            role="alert"
            className="mt-5 rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-3 text-sm text-[var(--status-critical)]"
          >
            No se pudo iniciar sesión. Verifica tus credenciales e inténtalo de
            nuevo.
          </p>
        ) : null}

        {passwordUpdated ? (
          <p
            role="status"
            className="mt-5 rounded-md border border-[var(--color-border)] bg-[var(--status-new-bg)] p-3 text-sm text-[var(--color-text)]"
          >
            La contraseña fue actualizada. Ya puedes iniciar sesión.
          </p>
        ) : null}

        <form action={signIn} className="mt-6 space-y-5">
          <input type="hidden" name="next" value={nextPath} />
          <label className="block text-sm font-semibold">
            Correo electrónico
            <input
              className="mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] bg-white px-3 text-base outline-none focus:border-[var(--brand-green)] focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              required
            />
          </label>
          <label className="block text-sm font-semibold">
            Contraseña
            <input
              className="mt-2 min-h-12 w-full rounded-md border border-[var(--color-border-strong)] bg-white px-3 text-base outline-none focus:border-[var(--brand-green)] focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button
            className="min-h-12 w-full rounded-md bg-[var(--brand-green)] px-4 font-semibold text-white shadow-sm hover:bg-[#095923] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
            type="submit"
          >
            Ingresar
          </button>
        </form>

        <noscript>
          <p className="mt-4 text-xs text-[var(--color-text-muted)]">
            El inicio de sesión funciona sin JavaScript mediante un formulario
            seguro del servidor.
          </p>
        </noscript>
      </section>
    </main>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
