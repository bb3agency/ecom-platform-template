"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Notice, Panel } from "@/components/ui/console";

interface AdminSectionProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  /** Body runs edge to edge (tables, lists). */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * Titled section with loading / error / empty states, on the console Panel.
 * Panel's grid-cols-1 + min-w-0 keeps wide children (tables, long AWBs/emails)
 * from inflating the section past a phone viewport.
 */
export function AdminSection({
  title,
  description,
  actions,
  loading,
  error,
  empty,
  emptyMessage = "Nothing here yet.",
  flush,
  className,
  children,
}: AdminSectionProps) {
  const showBody = !loading && !error && !empty;
  return (
    <Panel
      title={title}
      description={description}
      actions={actions}
      flush={flush && showBody}
      className={className}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : null}
      {!loading && error ? <Notice tone="danger">{error}</Notice> : null}
      {!loading && !error && empty ? <p className="py-2 text-sm text-muted-foreground">{emptyMessage}</p> : null}
      {showBody ? children : null}
    </Panel>
  );
}
