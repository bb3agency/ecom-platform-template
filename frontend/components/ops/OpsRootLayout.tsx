"use client";

import "@/components/ui/console-theme.css";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { OpsConsoleShell } from "@/components/ops/OpsConsoleShell";

interface OpsRootLayoutProps {
  children: ReactNode;
}

/** The only public ops routes. Everything else requires an ops session and gets the console shell. */
function isPublicOpsPath(pathname: string): boolean {
  return pathname === "/ops/login" || pathname === "/ops/setup";
}

export function OpsRootLayout({ children }: OpsRootLayoutProps) {
  const pathname = usePathname();

  if (isPublicOpsPath(pathname)) {
    return <>{children}</>;
  }

  return <OpsConsoleShell>{children}</OpsConsoleShell>;
}
