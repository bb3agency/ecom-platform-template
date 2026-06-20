"use client";

/**
 * AdminShellContext — export-handler pub/sub only.
 * Date ranges are now managed locally per page.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from "react";

interface AdminShellContextValue {
  /** Pages call this on mount and return the cleanup fn. */
  registerExportHandler: (handler: () => void) => () => void;
  /** Called by the shell Export button. */
  triggerExport: () => void;
}

const AdminShellContext = createContext<AdminShellContextValue | null>(null);

export function AdminShellProvider({ children }: { children: ReactNode }) {
  const exportHandlerRef = useRef<(() => void) | null>(null);

  const registerExportHandler = useCallback((handler: () => void) => {
    exportHandlerRef.current = handler;
    return () => {
      if (exportHandlerRef.current === handler) {
        exportHandlerRef.current = null;
      }
    };
  }, []);

  const triggerExport = useCallback(() => {
    if (exportHandlerRef.current) {
      exportHandlerRef.current();
    }
  }, []);

  return (
    <AdminShellContext.Provider
      value={{ registerExportHandler, triggerExport }}
    >
      {children}
    </AdminShellContext.Provider>
  );
}

export function useAdminShell(): AdminShellContextValue {
  const ctx = useContext(AdminShellContext);
  if (!ctx)
    throw new Error("useAdminShell must be used inside AdminShellProvider");
  return ctx;
}
