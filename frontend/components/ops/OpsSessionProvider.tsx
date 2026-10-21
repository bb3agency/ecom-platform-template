"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { OpsLoadShedStatus, OpsSession } from "@/lib/ops-client-api";

interface OpsSessionContextValue {
  session: OpsSession;
  /** Current traffic mode, polled by the shell. Null until the first response. */
  loadShed: OpsLoadShedStatus | null;
  /** Re-read the traffic mode now (e.g. right after changing it). */
  refreshLoadShed: () => Promise<void>;
}

const OpsSessionContext = createContext<OpsSessionContextValue | null>(null);

interface OpsSessionProviderProps extends OpsSessionContextValue {
  children: ReactNode;
}

export function OpsSessionProvider({ session, loadShed, refreshLoadShed, children }: OpsSessionProviderProps) {
  return (
    <OpsSessionContext.Provider value={{ session, loadShed, refreshLoadShed }}>{children}</OpsSessionContext.Provider>
  );
}

function useOpsContext(): OpsSessionContextValue {
  const value = useContext(OpsSessionContext);
  if (!value) {
    throw new Error("useOpsSession must be used within OpsSessionProvider");
  }
  return value;
}

export function useOpsSession(): OpsSession {
  return useOpsContext().session;
}

export function useOpsCanWrite(): boolean {
  return useOpsSession().permissions.some((permission) => permission === "ops:write");
}

export function useOpsLoadShed(): Pick<OpsSessionContextValue, "loadShed" | "refreshLoadShed"> {
  const { loadShed, refreshLoadShed } = useOpsContext();
  return { loadShed, refreshLoadShed };
}
