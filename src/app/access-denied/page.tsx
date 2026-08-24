import Image from "next/image";

import carnalesLogo from "../../../carnalesComp.png";

import { signOut } from "../login/actions";

export default function AccessDeniedPage() {
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
          <p className="text-sm font-semibold text-[var(--status-critical)]">
            Acceso no autorizado
          </p>
          <h1 className="mt-2 text-2xl font-bold">Tu cuenta no tiene acceso</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
            Tu inicio de sesión es válido, pero esta cuenta aún no tiene un
            perfil de empleado activo con los permisos necesarios. Solicita a un
            administrador que la configure.
          </p>
        </div>
        <form action={signOut} className="mt-6">
          <button
            className="min-h-12 w-full rounded-md border border-[var(--color-border-strong)] bg-white px-4 font-semibold text-[var(--color-text)] shadow-sm hover:bg-[var(--color-surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
            type="submit"
          >
            Cerrar sesión
          </button>
        </form>
      </section>
    </main>
  );
}
