type HomePageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>;

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const signOutFailed = first(params.session_error) === "sign_out_failed";

  return (
    <div>
      {signOutFailed ? (
        <p
          role="alert"
          className="mb-6 rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-4 text-sm font-semibold text-[var(--status-critical)]"
        >
          No se pudo cerrar la sesión. Inténtalo nuevamente.
        </p>
      ) : null}

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <p className="text-sm font-semibold text-[var(--brand-green)]">
          Centro de operaciones
        </p>
        <h1 className="mt-2 text-3xl font-bold">Bienvenido a Carnales</h1>
        <p className="mt-3 max-w-2xl leading-7 text-[var(--color-text-muted)]">
          Tu espacio de trabajo muestra únicamente los módulos asociados a los
          permisos vigentes de tu cuenta.
        </p>
      </section>

      <section
        aria-labelledby="workspace-status"
        className="mt-6 grid gap-4 sm:grid-cols-2"
      >
        <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-sm)]">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[var(--status-new-bg)] text-[var(--brand-green)]">
            <span aria-hidden="true" className="text-xl font-bold">
              ✓
            </span>
          </div>
          <h2 id="workspace-status" className="mt-4 text-lg font-bold">
            Sesión verificada
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
            Tu identidad y tus permisos se comprobaron en el servidor antes de
            mostrar este espacio.
          </p>
        </article>
        <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-sm)]">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[var(--color-surface-muted)] text-[var(--status-info)]">
            <span aria-hidden="true" className="text-lg font-bold">
              i
            </span>
          </div>
          <h2 className="mt-4 text-lg font-bold">Módulos en preparación</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
            Las opciones autorizadas aparecen en la navegación y se habilitarán
            conforme se incorporen las pantallas operativas.
          </p>
        </article>
      </section>
    </div>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
