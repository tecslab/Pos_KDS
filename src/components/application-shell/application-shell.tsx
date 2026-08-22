import Image from "next/image";
import type { ReactNode } from "react";

import carnalesLogo from "../../../carnalesComp.png";
import {
  roleLabel,
  type AuthorizedEmployeeContext,
  type NavigationItem,
} from "../../application";

import { ShellNavigation } from "./shell-navigation";

type ApplicationShellProps = Readonly<{
  context: AuthorizedEmployeeContext;
  navigation: readonly NavigationItem[];
  signOutAction(): Promise<never>;
  children: ReactNode;
}>;

export function ApplicationShell({
  context,
  navigation,
  signOutAction,
  children,
}: ApplicationShellProps) {
  const roleNames = context.roleCodes.map(roleLabel);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] md:grid md:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
      <aside className="hidden border-r border-[var(--color-border)] bg-[var(--color-surface)] md:flex md:min-h-screen md:flex-col">
        <div className="flex h-[var(--topbar-height)] items-center border-b border-[var(--color-border)] px-6">
          <Image
            src={carnalesLogo}
            alt="Carnales"
            className="h-auto w-32"
            priority
          />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <p className="mb-3 px-3 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
            Módulos
          </p>
          <ShellNavigation items={navigation} />
        </div>
        <div className="border-t border-[var(--color-border)] p-5">
          <p className="text-sm font-semibold">{context.displayName}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
            {roleNames.join(" · ")}
          </p>
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            Accesos mostrados según los permisos vigentes de tu cuenta.
          </p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
          <div className="flex min-h-[var(--topbar-height)] items-center gap-4 px-4 sm:px-6">
            <Image
              src={carnalesLogo}
              alt="Carnales"
              className="h-auto w-28 md:hidden"
              priority
            />
            <div className="ml-auto min-w-0 text-right">
              <p className="truncate text-sm font-semibold">
                {context.displayName}
              </p>
              <p
                role="status"
                className="flex items-center justify-end gap-1.5 text-xs text-[var(--color-text-muted)]"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-[var(--status-new)]"
                />
                Sesión activa
              </p>
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                className="min-h-12 rounded-md border border-[var(--color-border-strong)] bg-white px-3 text-sm font-semibold hover:bg-[var(--color-surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 sm:px-4"
              >
                <span className="hidden sm:inline">Cerrar sesión</span>
                <span className="sm:hidden">Salir</span>
              </button>
            </form>
          </div>
          <div className="overflow-x-auto border-t border-[var(--color-border)] md:hidden">
            <ShellNavigation items={navigation} compact />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[var(--content-max)] p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
