import { requireAuthenticatedSession } from "@/lib/auth/server-session";

import { signOut } from "./login/actions";

export default async function Home() {
  const session = await requireAuthenticatedSession("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-6 text-[var(--color-text)]">
      <section className="w-full max-w-xl rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-sm)]">
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Carnales
        </p>
        <h1 className="mt-3 text-3xl font-bold">Sesión activa</h1>
        <p className="mt-3 text-base text-[var(--color-text-muted)]">
          {session.email ?? "Usuario autenticado"}
        </p>
        <form action={signOut} className="mt-8">
          <button
            type="submit"
            className="min-h-12 rounded-md border border-[var(--color-border-strong)] bg-white px-5 font-semibold hover:bg-[var(--color-surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
          >
            Cerrar sesión
          </button>
        </form>
      </section>
    </main>
  );
}
