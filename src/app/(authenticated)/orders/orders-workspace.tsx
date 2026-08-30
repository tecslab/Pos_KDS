"use client";

import { useState } from "react";

import { ActiveOrderEditor } from "./active-order-editor";
import { OrderDraftComposer } from "./order-draft-composer";

type WorkspaceMode = "create" | "edit";

export function OrdersWorkspace() {
  const [mode, setMode] = useState<WorkspaceMode>("create");

  return (
    <div>
      <nav
        aria-label="Acciones del punto de venta"
        className="mb-5 flex flex-wrap gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-sm)]"
      >
        <WorkspaceButton
          selected={mode === "create"}
          onClick={() => setMode("create")}
        >
          Nueva orden
        </WorkspaceButton>
        <WorkspaceButton
          selected={mode === "edit"}
          onClick={() => setMode("edit")}
        >
          Editar orden activa
        </WorkspaceButton>
      </nav>
      {mode === "create" ? <OrderDraftComposer /> : <ActiveOrderEditor />}
    </div>
  );
}

function WorkspaceButton({
  selected,
  onClick,
  children,
}: Readonly<{
  selected: boolean;
  onClick(): void;
  children: React.ReactNode;
}>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-12 rounded-md border px-4 py-2 font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-green)] focus:ring-offset-2 ${
        selected
          ? "border-[var(--brand-green)] bg-[var(--status-new-bg)] text-[var(--brand-green)]"
          : "border-[var(--color-border-strong)] bg-white hover:bg-[var(--color-surface-muted)]"
      }`}
    >
      {children}
    </button>
  );
}
