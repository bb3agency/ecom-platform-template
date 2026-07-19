import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Unified badge system — small rounded pill, minimal color, no gradients.
 * One component for status / role / inventory / marketing / payment labels.
 * Colors are deliberately brand-independent (success is always green, danger
 * always red) so states read instantly regardless of the client theme.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        /** Neutral/default label. */
        default: "bg-muted text-muted-foreground",
        /** Positive: Active, In Stock, Paid, Delivered. */
        success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        /** Attention: Pending, Low Stock, Processing. */
        warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        /** Negative: Banned, Failed, Out of Stock, Cancelled. */
        destructive: "bg-red-500/10 text-red-700 dark:text-red-400",
        /** Informational: Sync states, counts. */
        info: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
        /** Marketing: Featured, Offer. */
        feature: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
        /** Marketing: Bestseller, Hot. */
        highlight: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
        /** Outlined neutral (roles, secondary metadata). */
        outline: "border border-border bg-transparent text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const DOT_COLOR: Record<string, string> = {
  default: "bg-muted-foreground",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  destructive: "bg-red-500",
  info: "bg-sky-500",
  feature: "bg-violet-500",
  highlight: "bg-orange-500",
  outline: "bg-muted-foreground",
};

interface BadgeProps extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {
  /** Leading status dot (per the design system's status badges). */
  dot?: boolean;
}

function Badge({ className, variant = "default", dot, children, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props}>
      {dot && (
        <span aria-hidden className={cn("size-1.5 rounded-full", DOT_COLOR[variant ?? "default"])} />
      )}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
