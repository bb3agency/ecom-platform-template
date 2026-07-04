"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { createIdempotencyKey } from "@/lib/idempotency";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";

function promptReplayCredentials(): { reason: string; approvalToken: string } | null {
  const reason = window.prompt("Replay reason (min 8 characters):")?.trim() ?? "";
  if (reason.length < 8) {
    window.alert("Reason must be at least 8 characters.");
    return null;
  }
  const approvalToken = window.prompt("Approval token:")?.trim() ?? "";
  if (!approvalToken) {
    window.alert("Approval token is required.");
    return null;
  }
  return { reason, approvalToken };
}

export function AdminReplayActions({
  previewEndpoint,
  replayEndpoint,
  onComplete,
}: {
  previewEndpoint: string;
  replayEndpoint: string;
  onComplete?: () => void;
}) {
  const api = useAuthenticatedApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(mode: "preview" | "replay") {
    setBusy(mode);
    setError(null);
    setMessage(null);
    try {
      if (mode === "preview") {
        const result = await api<unknown>(previewEndpoint, {
          method: "POST",
          idempotencyKey: createIdempotencyKey(),
          body: JSON.stringify({}),
        });
        setMessage(JSON.stringify(result, null, 2));
      } else {
        const credentials = promptReplayCredentials();
        if (!credentials) return;
        const result = await api<unknown>(replayEndpoint, {
          method: "POST",
          idempotencyKey: createIdempotencyKey(),
          body: JSON.stringify(credentials),
        });
        setMessage(JSON.stringify(result, null, 2));
        onComplete?.();
      }
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-1">
      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void run("preview")}
        >
          Preview
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy !== null}
          onClick={() => void run("replay")}
        >
          Replay
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {message ? (
        <pre className="max-h-24 overflow-auto rounded bg-muted/40 p-2 text-[10px]">
          {message}
        </pre>
      ) : null}
    </div>
  );
}
