"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { OpsSession } from "@/lib/ops-client-api";

interface OpsSessionContextValue {
  session: OpsSession;
}

const OpsSessionContext = createContext<OpsSessionContextValue | null>(null);

interface OpsSessionProviderProps {
  session: OpsSession;
  children: ReactNode;
}

export function OpsSessionProvider({ session, children }: OpsSessionProviderProps) {
  return (
    <OpsSessionContext.Provider value={{ session }}>{children}</OpsSessionContext.Provider>
  );
}

export function useOpsSession(): OpsSession {
  const value = useContext(OpsSessionContext);
  if (!value) {
    throw new Error("useOpsSession must be used within OpsSessionProvider");
  }
  return value.session;
}

export function useOpsCanWrite(): boolean {
  const session = useOpsSession();
  return session.permissions.some((permission) => permission === "ops:write");
}
