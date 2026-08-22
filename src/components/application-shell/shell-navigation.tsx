"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavigationIcon, NavigationItem } from "../../application";

type ShellNavigationProps = Readonly<{
  items: readonly NavigationItem[];
  compact?: boolean;
}>;

/** Presentation-only filtering result; protected operations still use server guards. */
export function ShellNavigation({
  items,
  compact = false,
}: ShellNavigationProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegación principal">
      <ul
        className={
          compact ? "flex min-w-max gap-2 px-4 py-3" : "flex flex-col gap-1.5"
        }
      >
        {items.map((item) => {
          const active =
            item.available &&
            (item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(`${item.href}/`) || pathname === item.href);
          const content = (
            <>
              <NavigationGlyph icon={item.icon} />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {!item.available ? (
                <span className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">
                  Próximamente
                </span>
              ) : null}
            </>
          );
          const classes = [
            "flex min-h-12 items-center gap-3 rounded-md border px-3 text-sm font-semibold transition-colors",
            compact ? "min-w-44" : "w-full",
            active
              ? "border-[var(--brand-green)] bg-[var(--status-new-bg)] text-[var(--brand-green)]"
              : "border-transparent text-[var(--color-text)]",
            item.available
              ? "hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2"
              : "cursor-not-allowed bg-[var(--color-surface-muted)] text-[var(--status-disabled)]",
          ].join(" ");

          return (
            <li key={item.id}>
              {item.available ? (
                <Link
                  href={item.href}
                  className={classes}
                  aria-current={active ? "page" : undefined}
                >
                  {content}
                </Link>
              ) : (
                <div className={classes} aria-disabled="true">
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function NavigationGlyph({ icon }: Readonly<{ icon: NavigationIcon }>) {
  const paths: Readonly<Record<NavigationIcon, string>> = {
    home: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-8.5Z",
    orders: "M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5",
    kitchen:
      "M6 3v7 M3 3v4c0 2 1 3 3 3s3-1 3-3V3 M6 10v11 M16 3v18 M16 3c3 2 4 5 4 8h-4",
    delivery:
      "M3 7h11v9H3z M14 10h4l3 3v3h-7z M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
    payments: "M3 6h18v12H3z M3 10h18 M7 15h3",
    inventory: "m4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7 M12 11v10",
    production: "M4 20V9l5 3V9l5 3V4h6v16H4z M17 8h3",
    reports: "M5 20V10h3v10H5Zm6 0V4h3v16h-3Zm6 0v-7h3v7h-3Z",
    administration:
      "M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7l-8-4Zm0 5v8 M8 12h8",
    audit: "M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4",
  };

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[icon]} />
    </svg>
  );
}
