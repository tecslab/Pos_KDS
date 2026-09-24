"use client";

import { useFormStatus } from "react-dom";

export function PasswordSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="min-h-12 w-full rounded-md bg-[var(--brand-green)] px-4 font-semibold text-white shadow-sm hover:bg-[#095923] focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
      disabled={pending}
      type="submit"
    >
      {pending ? "Guardando…" : "Guardar contraseña"}
    </button>
  );
}
