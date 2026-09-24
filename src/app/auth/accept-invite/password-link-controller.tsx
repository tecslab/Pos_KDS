"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  classifyImplicitPasswordLink,
  consumeImplicitPasswordLink,
  type ImplicitPasswordLinkResult,
  type PasswordLinkMode,
} from "@/lib/auth/password-link";
import { createImplicitPasswordLinkClient } from "@/lib/supabase/implicit-password-link-client";

type ControllerStatus =
  ImplicitPasswordLinkResult["code"] | "processing" | "update_failed";

export function PasswordLinkController({
  initialMode,
  initialStatus,
}: Readonly<{
  initialMode: PasswordLinkMode | null;
  initialStatus: string | undefined;
}>) {
  const router = useRouter();
  const [status, setStatus] = useState<ControllerStatus>(() =>
    fixedInitialStatus(initialStatus),
  );
  const [mode, setMode] = useState<PasswordLinkMode | null>(initialMode);

  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    const classification = classifyImplicitPasswordLink(url);
    if (classification === null) {
      scrubFragment(initialMode);
      if (url.hash.length > 1) {
        queueMicrotask(() => {
          if (active) setStatus("expired_or_invalid");
        });
      }
      return () => {
        active = false;
      };
    }

    queueMicrotask(() => {
      if (!active) return;
      setStatus("processing");
      setMode(classification.mode);
    });
    const client = createImplicitPasswordLinkClient();
    void consumeImplicitPasswordLink(classification, client.auth, {
      scrubFragment: () => scrubFragment(classification.mode),
      bootstrap: async (accessToken, callbackMode) => {
        if (window.location.hash.length > 0) return false;
        const response = await fetch("/auth/accept-invite/bootstrap", {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mode: callbackMode }),
        });
        if (!response.ok) return false;
        const result: unknown = await response.json();
        return (
          typeof result === "object" &&
          result !== null &&
          "status" in result &&
          result.status === "ready"
        );
      },
    }).then((result) => {
      if (!active) return;
      setStatus(result.code);
      setMode(result.mode);
      if (result.code === "ready") router.refresh();
    });

    return () => {
      active = false;
    };
  }, [initialMode, router]);

  if (status === "processing" || status === "ready") {
    return (
      <p
        role="status"
        className="mt-5 rounded-md border border-[var(--color-border)] bg-[var(--status-new-bg)] p-3 text-sm text-[var(--color-text)]"
      >
        Validando el enlace…
      </p>
    );
  }

  return (
    <p
      role="alert"
      className="mt-5 rounded-md border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-3 text-sm text-[var(--status-critical)]"
    >
      {failureMessage(status, mode)}
    </p>
  );
}

function fixedInitialStatus(value: string | undefined): ControllerStatus {
  return value === "expired_or_invalid" ||
    value === "unusable" ||
    value === "update_failed"
    ? value
    : value === "processing"
      ? "processing"
      : "missing";
}

function scrubFragment(mode: PasswordLinkMode | null) {
  const clean = new URL("/auth/accept-invite", window.location.origin);
  if (mode !== null) clean.searchParams.set("mode", mode);
  window.history.replaceState(null, "", `${clean.pathname}${clean.search}`);
}

function failureMessage(
  status: Exclude<ControllerStatus, "processing" | "ready">,
  mode: PasswordLinkMode | null,
): string {
  const prefix =
    status === "missing"
      ? "El enlace está incompleto."
      : status === "update_failed"
        ? "No se pudo guardar la contraseña."
        : status === "unusable"
          ? "El enlace no se puede usar en esta sesión."
          : "El enlace no es válido o ya expiró.";
  return mode === "recovery"
    ? `${prefix} Solicita un nuevo correo para restablecer tu contraseña.`
    : mode === "invite"
      ? `${prefix} Solicita una nueva invitación al administrador.`
      : `${prefix} Solicita un enlace nuevo.`;
}
