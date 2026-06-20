"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useAdminSessionRestore } from "@/hooks/use-admin-session-restore";
import {
  redirectToAdminLogin,
  redirectToAdminLoginIfNeeded,
} from "@/lib/admin-auth-navigation";
import { resolveAdminUser } from "@/lib/resolve-admin-user";
import { AdminSessionRestoreGate } from "@/components/auth/AdminSessionRestoreGate";
import { AdminLoadingBlock } from "@/components/admin/ui/admin-ui";
import type { User } from "@/types/user";
import type { AuthSessionRestoreStatus } from "@/hooks/use-auth-session-restore";

/** Max time to block admin chrome while cookie restore runs (page may already be 200 from RSC). */
const ADMIN_RESTORE_WATCHDOG_MS = 12_000;

interface AdminAuthContextValue {
  status: AuthSessionRestoreStatus;
  accessToken: string | null;
  user: User;
  adminUser: User;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const { status, accessToken, user } = useAdminSessionRestore();
  const adminUser = useMemo(
    () => resolveAdminUser(accessToken, user),
    [accessToken, user],
  );
  const sessionReady = status === "ready" && adminUser !== null;

  useEffect(() => {
    if (status === "failed") {
      redirectToAdminLoginIfNeeded();
    }
  }, [status]);

  useEffect(() => {
    if (status === "ready" && !adminUser) {
      const timer = window.setTimeout(() => redirectToAdminLogin(), 400);
      return () => window.clearTimeout(timer);
    }
  }, [status, adminUser]);

  useEffect(() => {
    if (status !== "checking" && status !== "restoring") {
      return;
    }
    const timer = window.setTimeout(() => {
      // Redirect only — avoid logoutLocalSession here, which would bump the restore
      // nonce and restart cookie refresh while navigation is in flight (mobile loop).
      redirectToAdminLoginIfNeeded();
    }, ADMIN_RESTORE_WATCHDOG_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  if (status === "checking" || status === "restoring") {
    return (
      <AdminSessionRestoreGate
        label={
          status === "checking"
            ? "Loading admin console…"
            : "Restoring admin session…"
        }
      />
    );
  }

  if (status === "failed") {
    return (
      <div className="admin-console flex min-h-[100dvh] items-center justify-center bg-background px-4">
        <AdminLoadingBlock label="Redirecting to sign in…" />
      </div>
    );
  }

  if (!sessionReady || !adminUser) {
    return (
      <AdminSessionRestoreGate
        label="Checking admin session…"
        autoRedirectOnTimeout
      />
    );
  }

  return (
    <AdminAuthContext.Provider
      value={{
        status,
        accessToken,
        user: adminUser,
        adminUser,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth must be used within AdminAuthProvider");
  }
  return ctx;
}
