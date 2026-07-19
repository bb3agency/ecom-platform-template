"use client";

import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";

type Tone = "success" | "warning" | "destructive" | "default";

interface AdminStatusBadgeProps extends ComponentProps<"span"> {
  label: string;
  tone?: Tone;
  /** Show the leading status dot (design-system status badges). */
  dot?: boolean;
}

/**
 * Thin wrapper over the unified Badge preserving the legacy `label`/`tone` API
 * used across the admin lists. New code should use `Badge` directly.
 */
export function AdminStatusBadge({
  label,
  tone = "default",
  dot = true,
  className,
  ...props
}: AdminStatusBadgeProps) {
  return (
    <Badge variant={tone} dot={dot} className={className} {...props}>
      {label}
    </Badge>
  );
}
