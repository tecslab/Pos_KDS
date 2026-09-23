"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function AcceptInvitePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function acceptInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    if (typeof password !== "string" || password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: updateError } = await createBrowserSupabaseClient().auth.updateUser({ password });
    if (updateError) {
      setSubmitting(false);
      setError("La invitación no es válida o expiró. Solicita una nueva invitación.");
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return <main><h1>Activa tu cuenta</h1><p>Define tu contraseña para continuar.</p><form onSubmit={acceptInvite}><label>Contraseña<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>{error ? <p role="alert">{error}</p> : null}<button disabled={submitting} type="submit">{submitting ? "Activando…" : "Activar cuenta"}</button></form></main>;
}
