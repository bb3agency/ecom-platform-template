"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import { useAdminSessionRestore } from "@/hooks/use-admin-session-restore";
import { redirectToAdminLogin } from "@/lib/admin-auth-navigation";
import { canAccessAdmin } from "@/lib/permissions";
import { resolveAdminUser } from "@/lib/resolve-admin-user";
import { AdminSessionRestoreGate } from "@/components/auth/AdminSessionRestoreGate";
import { AdminLoadingBlock } from "@/components/admin/ui/admin-ui";
import { useAuthStore } from "@/stores/auth";

interface AdminGuardProps {
  children: ReactNode;
}

export function AdminGuard({ children }: AdminGuardProps) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { status, user } = useAdminSessionRestore();

  const adminUser = useMemo(
    () => resolveAdminUser(accessToken, user),
    [accessToken, user],
  );

  const sessionReady = status === "ready" && adminUser !== null;

  useEffect(() => {
    if (status === "failed") {
      redirectToAdminLogin();
    }
  }, [status]);

  useEffect(() => {
    if (status === "ready" && user && !canAccessAdmin(user)) {
      redirectToAdminLogin();
    }
  }, [status, user]);

  if (status === "checking" || status === "restoring") {
    return (
      <AdminSessionRestoreGate
        label="Restoring admin session…"
        className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-[#faf3ef] px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      />
    );
  }

  if (status === "failed") {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#faf3ef] px-4">
        <AdminLoadingBlock label="Redirecting to sign in…" />
      </div>
    );
  }

  if (!sessionReady || !adminUser) {
    return (
      <AdminSessionRestoreGate
        label="Checking permissions…"
        className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-[#faf3ef] px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      />
    );
  }

  return <>{children}</>;
}
