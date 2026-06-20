"use client";

/**
 * Per-panel session guard. Prefer `OpsConsoleShell` in `app/(ops)/ops/layout.tsx`
 * for route-level protection; keep this for isolated client panels if needed.
 */
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getOpsSessionClient,
  isOpsUnauthorisedError,
  type OpsSession,
} from "@/lib/ops-client-api";

interface OpsSessionGateProps {
  children: ReactNode;
}

export function OpsSessionGate({ children }: OpsSessionGateProps) {
  const [session, setSession] = useState<OpsSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const nextSession = await getOpsSessionClient();
        if (!cancelled) {
          setSession(nextSession);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSession(null);
          setError(
            isOpsUnauthorisedError(err)
              ? "Ops session required."
              : "Unable to load ops session.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading ops session...</p>;
  }

  if (!session) {
    return (
      <div className="grid gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <p>{error ?? "Sign in to continue."}</p>
        <Link href="/ops/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Go to ops login
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
