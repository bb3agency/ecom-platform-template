"use client";

import type { ReactNode } from "react";

interface AdminDetailDrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function AdminDetailDrawer({
  open,
  title,
  onClose,
  children,
}: AdminDetailDrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close drawer"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-full flex-col border-l border-border bg-card shadow-xl sm:max-w-md">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-heading text-lg font-semibold">{title}</h3>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>
  );
}
