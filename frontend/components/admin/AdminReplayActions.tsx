"use client";

import { useState } from "react";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { createIdempotencyKey } from "@/lib/idempotency";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";

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

  // Replay credential modal (replaces the old window.prompt pair).
  const [replayOpen, setReplayOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [approvalToken, setApprovalToken] = useState("");
  const reasonOk = reason.trim().length >= 8;
  const tokenOk = approvalToken.trim().length > 0;

  async function runPreview() {
    setBusy("preview");
    setError(null);
    setMessage(null);
    try {
      const result = await api<unknown>(previewEndpoint, {
        method: "POST",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({}),
      });
      setMessage(JSON.stringify(result, null, 2));
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setBusy(null);
    }
  }

  async function runReplay() {
    if (!reasonOk || !tokenOk) return;
    setBusy("replay");
    setError(null);
    setMessage(null);
    try {
      const result = await api<unknown>(replayEndpoint, {
        method: "POST",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({
          reason: reason.trim(),
          approvalToken: approvalToken.trim(),
        }),
      });
      setMessage(JSON.stringify(result, null, 2));
      setReplayOpen(false);
      setReason("");
      setApprovalToken("");
      onComplete?.();
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
          onClick={() => void runPreview()}
        >
          Preview
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy !== null}
          onClick={() => setReplayOpen(true)}
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

      <Dialog open={replayOpen} onOpenChange={(open) => busy === null && setReplayOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcwIcon className="size-4 text-primary" />
              Replay Failed Job
            </DialogTitle>
            <DialogDescription>
              Re-dispatches the dead-lettered message through its original queue. Provide an
              audit reason and the approval token.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Reason</span>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why is this replay needed? (min 8 characters)"
                rows={3}
                disabled={busy !== null}
              />
              {!reasonOk && reason.length > 0 && (
                <span className="text-xs text-destructive">
                  Reason must be at least 8 characters.
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Approval token</span>
              <Input
                value={approvalToken}
                onChange={(event) => setApprovalToken(event.target.value)}
                placeholder="Approval token"
                autoComplete="off"
                disabled={busy !== null}
              />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => setReplayOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!reasonOk || !tokenOk || busy !== null}
              loading={busy === "replay"}
              onClick={() => void runReplay()}
            >
              Replay Queue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
