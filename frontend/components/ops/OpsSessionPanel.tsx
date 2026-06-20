"use client";

import { useEffect, useState } from "react";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { getOpsSessionClient, type OpsSession } from "@/lib/ops-client-api";

export function OpsSessionPanel() {
  return <OpsSessionDetails />;
}

function OpsSessionDetails() {
  const [session, setSession] = useState<OpsSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getOpsSessionClient()
      .then((data) => {
        if (!cancelled) {
          setSession(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(getApiErrorMessageWithHint(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!session) {
    return <p className="text-sm text-muted-foreground">Loading session profile…</p>;
  }

  return (
    <section className="grid gap-4 rounded-lg border border-border p-6">
      <h2 className="font-heading text-xl font-semibold">Session bootstrap</h2>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Ops user</dt>
          <dd>{session.name}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{session.email}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">MFA posture</dt>
          <dd>{session.mfaEnabled ? "Enabled" : "Disabled"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Permissions</dt>
          <dd>{session.permissions.join(", ") || "None"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">IP allowlist</dt>
          <dd>{session.ipAllowlist.join(", ") || "None"}</dd>
        </div>
      </dl>
    </section>
  );
}
