"use client";

import { useCallback } from "react";
import type { User } from "@/types/user";
import {
  useAuthSessionRestore,
  type AuthSessionRestoreStatus,
} from "@/hooks/use-auth-session-restore";

export type AccountSessionRestoreStatus = AuthSessionRestoreStatus;

interface UseAccountSessionRestoreResult {
  status: AccountSessionRestoreStatus;
  accessToken: string | null;
  user: User | null;
}

/**
 * Customer account area.
 * Only accepts tokens issued to CUSTOMER role — prevents admin tokens from
 * entering customer UI and hitting /users/me which requires CUSTOMER role.
 */
export function useAccountSessionRestore(): UseAccountSessionRestoreResult {
  const validateUser = useCallback(
    (candidate: User) =>
      Boolean(candidate.id) &&
      (candidate.role === "CUSTOMER" || candidate.role == null),
    [],
  );
  return useAuthSessionRestore({ validateUser, audience: "customer" });
}
