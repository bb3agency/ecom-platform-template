"use client";

import { useCallback } from "react";
import { isAdminUser } from "@/lib/permissions";
import type { User } from "@/types/user";
import {
  useAuthSessionRestore,
  type AuthSessionRestoreStatus,
} from "@/hooks/use-auth-session-restore";

export type AdminSessionRestoreStatus = AuthSessionRestoreStatus;

interface UseAdminSessionRestoreResult {
  status: AdminSessionRestoreStatus;
  accessToken: string | null;
  user: User | null;
}

interface UseAdminSessionRestoreOptions {
  /** When false, failed cookie restore does not hard-navigate (e.g. /admin/login). */
  redirectOnFailure?: boolean;
}

export function useAdminSessionRestore(
  options: UseAdminSessionRestoreOptions = {},
): UseAdminSessionRestoreResult {
  const { redirectOnFailure = true } = options;
  const validateUser = useCallback((candidate: User) => isAdminUser(candidate), []);
  return useAuthSessionRestore({
    validateUser,
    audience: "admin",
    redirectOnFailure,
  });
}

/** Cookie restore on /admin/login — isolated from protected `/admin` runtime. */
export function useAdminGuestSessionRestore(): UseAdminSessionRestoreResult {
  const validateUser = useCallback((candidate: User) => isAdminUser(candidate), []);
  return useAuthSessionRestore({
    validateUser,
    audience: "admin-guest",
    redirectOnFailure: false,
  });
}
