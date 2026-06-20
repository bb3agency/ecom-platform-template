"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAdminGuestSessionRestore } from "@/hooks/use-admin-session-restore";
import { resolveAdminUser } from "@/lib/resolve-admin-user";
import { useAuthStore } from "@/stores/auth";

interface AdminGuestOnlyProps {
  children: ReactNode;
  /** Where to send users who already have a valid admin session. */
  redirectTo?: string;
}

/**
 * Renders sign-in UI for guests. Cookie restore runs in the background; the form
 * is shown immediately (never blocked on "Checking admin session…").
 */
export function AdminGuestOnly({
  children,
  redirectTo = "/admin",
}: AdminGuestOnlyProps) {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const { status, user } = useAdminGuestSessionRestore();
  const redirectedRef = useRef(false);

  const adminUser = useMemo(
    () => resolveAdminUser(accessToken, user),
    [accessToken, user],
  );

  const hasAdminSession = status === "ready" && adminUser !== null;

  useEffect(() => {
    if (!hasAdminSession || redirectedRef.current) {
      return;
    }
    redirectedRef.current = true;
    router.replace(redirectTo);
  }, [hasAdminSession, redirectTo, router]);

  if (hasAdminSession) {
    return (
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        Redirecting to admin console…
      </p>
    );
  }

  return <>{children}</>;
}
