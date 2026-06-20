"use client";

import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

type Tone = "success" | "warning" | "destructive" | "default";

const toneStyles: Record<Tone, string> = {
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  destructive: "bg-red-500/10 text-red-700 dark:text-red-400",
  default: "bg-muted text-muted-foreground",
};

interface AdminStatusBadgeProps extends ComponentProps<"span"> {
  label: string;
  tone?: Tone;
}

export function AdminStatusBadge({
  label,
  tone = "default",
  className,
  ...props
}: AdminStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
        toneStyles[tone],
        className,
      )}
      {...props}
    >
      {label}
    </span>
  );
}
