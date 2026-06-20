"use client";

import { useEffect, useState, type ReactElement } from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

interface AdminResponsiveContainerProps {
  height: number | `${number}%`;
  /** Defaults to 100%. Use a fixed number for donut charts. */
  width?: number | `${number}%`;
  className?: string;
  children: ReactElement;
}

/**
 * Recharts measures its parent on mount. In flex/grid admin layouts the first
 * pass can be 0×0 (−1×−1), which spams the console. Mount after layout and
 * set minWidth={0} per Recharts guidance.
 */
export function AdminResponsiveContainer({
  height,
  width = "100%",
  className,
  children,
}: AdminResponsiveContainerProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  return (
    <div
      className={cn("min-w-0", className)}
      style={{
        height,
        width: typeof width === "number" ? width : "100%",
      }}
    >
      {ready ? (
        <ResponsiveContainer width={width} height={height} minWidth={0} debounce={50}>
          {children}
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
