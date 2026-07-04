"use client";

import { useState } from "react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { createIdempotencyKey } from "@/lib/idempotency";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";

interface AdminMutationPanelProps {
  title: string;
  endpoint: string;
  payloadLabel: string;
  payloadTemplate: string;
  method?: "POST" | "PATCH" | "DELETE";
}

export function AdminMutationPanel({
  title,
  endpoint,
  payloadLabel,
  payloadTemplate,
  method = "POST",
}: AdminMutationPanelProps) {
  const api = useAuthenticatedApi();
  const [payload, setPayload] = useState(payloadTemplate);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const parsed = payload.trim() ? JSON.parse(payload) : {};
      const response = await api(endpoint, {
        method,
        idempotencyKey: createIdempotencyKey(),
        body: method === "DELETE" ? undefined : JSON.stringify(parsed),
      });
      setResult(JSON.stringify(response, null, 2));
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-border p-4">
      <h3 className="font-medium">{title}</h3>
      <label className="grid min-w-0 grid-cols-1 gap-1 text-sm">
        {payloadLabel}
        <textarea
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          className="min-h-24 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
        />
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {submitting ? "Submitting..." : `${method} ${endpoint}`}
      </button>
      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {result ? (
        <pre className="max-h-56 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
          {result}
        </pre>
      ) : null}
    </section>
  );
}
