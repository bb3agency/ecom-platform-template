"use client";

import type { ReactNode } from "react";
import { AdminLoadingBlock } from "@/components/admin/ui/admin-ui";

interface AdminSectionProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  children?: ReactNode;
}

export function AdminSection({
  title,
  description,
  actions,
  loading,
  error,
  empty,
  emptyMessage = "No data yet.",
  children,
}: AdminSectionProps) {
  return (
    // grid-cols-1 (minmax(0,1fr)) + min-w-0 are load-bearing: an implicit auto
    // track lets any wide child (table, long AWB/email, unwrapped filter row)
    // inflate the section past the mobile viewport — reads as broken padding.
    <section className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </header>

      {loading ? <AdminLoadingBlock label="Loading…" /> : null}
      {!loading && error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && empty ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : null}
      {!loading && !error && !empty ? children : null}
    </section>
  );
}
