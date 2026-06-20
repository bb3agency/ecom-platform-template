"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminLoadingBlock } from "@/components/admin/ui/admin-ui";
import { Button } from "@/components/ui/button";
import { redirectToAdminLogin } from "@/lib/admin-auth-navigation";
import { useAuthStore } from "@/stores/auth";

const SLOW_RESTORE_MS = 3_000;
const RESTORE_ESCAPE_MS = 12_000;

interface AdminSessionRestoreGateProps {
  label: string;
  className?: string;
  /** When true, auto-navigate to sign-in if restore is still blocking after RESTORE_ESCAPE_MS. */
  autoRedirectOnTimeout?: boolean;
}

/**
 * Full-viewport loading gate while admin session restore runs.
 * Sign-in is always available (works even when client hydration is slow on LAN).
 */
export function AdminSessionRestoreGate({
  label,
  className = "admin-console flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))]",
  autoRedirectOnTimeout = true,
}: AdminSessionRestoreGateProps) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_RESTORE_MS);
    return () => window.clearTimeout(slowTimer);
  }, []);

  useEffect(() => {
    if (!autoRedirectOnTimeout) {
      return;
    }
    const escapeTimer = window.setTimeout(() => {
      redirectToAdminLogin();
    }, RESTORE_ESCAPE_MS);
    return () => window.clearTimeout(escapeTimer);
  }, [autoRedirectOnTimeout]);

  function handleSignInInstead() {
    useAuthStore.getState().logoutLocalSession();
    redirectToAdminLogin();
  }

  return (
    <div className={className}>
      <AdminLoadingBlock label={label} />
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        {slow ? (
          <p className="text-sm text-muted-foreground">
            Session restore is taking longer than usual. Check your network, or
            sign in again.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Restoring your session from this device…
          </p>
        )}
        <Button type="button" variant="outline" onClick={handleSignInInstead}>
          Sign in
        </Button>
        <Link
          href="/admin/login"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          Open admin sign-in
        </Link>
      </div>
    </div>
  );
}
