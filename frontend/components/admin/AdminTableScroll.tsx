"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Horizontal scroll wrapper for wide admin data tables on narrow viewports. */
export function AdminTableScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]",
        className,
      )}
    >
      {children}
    </div>
  );
}
