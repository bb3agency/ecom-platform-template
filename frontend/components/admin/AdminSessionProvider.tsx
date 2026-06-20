"use client";

import { useAuthStore } from "@/stores/auth";
import type { ReactNode } from "react";
import { resolveAdminUser } from "@/lib/resolve-admin-user";

interface AdminSessionProviderProps {
  children: ReactNode;
}

export function AdminSessionProvider({ children }: AdminSessionProviderProps) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const user = useAuthStore((state) => state.user);
  const adminUser = resolveAdminUser(accessToken, user);

  if (!adminUser) {
    return null;
  }

  return <>{children}</>;
}
