import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface EmptyStateProps extends React.ComponentProps<"div"> {
  icon?: LucideIcon;
  headline: string;
  description?: string;
  /** Call-to-action, e.g. an "Add Product" button. */
  action?: React.ReactNode;
}

/**
 * Friendly empty state: icon + headline + description + CTA — instead of a
 * bare "No products." line.
 */
export function EmptyState({
  icon: Icon,
  headline,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      {Icon && (
        <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-6" />
        </div>
      )}
      <p className="text-sm font-semibold text-foreground">{headline}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
