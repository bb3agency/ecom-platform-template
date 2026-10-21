"use client";

import { memo } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { StatusDot, type StatusTone } from "@/components/ui/console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { OpsConfigFieldDefinition } from "@/lib/ops-config-fields";

export interface OpsConfigDraftEntry {
  value: string;
  touched: boolean;
  cleared: boolean;
}

export type OpsConfigFieldState = "missing" | "restart" | "env" | "live";

/** Where the running value comes from, in operator terms. */
export function configFieldState(field: OpsConfigFieldDefinition): OpsConfigFieldState {
  if (field.envLocked) return "env";
  if (field.restartPending) return "restart";
  if (field.present) return "live";
  return "missing";
}

const STATE_COPY: Record<OpsConfigFieldState, { tone: StatusTone; label: string }> = {
  live: { tone: "success", label: "Live" },
  restart: { tone: "warning", label: "Saved · restart to apply" },
  env: { tone: "neutral", label: "Set in server environment" },
  missing: { tone: "danger", label: "Not set" },
};

interface OpsConfigFieldRowProps {
  field: OpsConfigFieldDefinition;
  entry: OpsConfigDraftEntry;
  canWrite: boolean;
  error?: string;
  onChange: (key: string, value: string) => void;
  onClear: (key: string) => void;
  onUndo: (key: string) => void;
}

const SELECT_CLASS =
  "console-select h-9 w-full appearance-none rounded-lg border border-input bg-card pl-3 pr-8 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive";

function OpsConfigFieldRowImpl({ field, entry, canWrite, error, onChange, onClear, onUndo }: OpsConfigFieldRowProps) {
  const state = configFieldState(field);
  const copy = STATE_COPY[state];
  const editable = canWrite && !field.envLocked;
  const dirty = entry.touched || entry.cleared;
  const hasSaved = Boolean(field.storedMasked);
  const inputId = `config-${field.key}`;
  const describedBy = [error ? `${inputId}-error` : null, field.hint ? `${inputId}-hint` : null].filter(Boolean).join(" ") || undefined;

  let placeholder = "Not set";
  if (entry.cleared) placeholder = "Will be removed when you save";
  else if (field.inputKind === "secret" && hasSaved) placeholder = `Saved (${field.storedMasked}) — type to replace`;

  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-1 gap-3 px-4 py-4 sm:px-5 md:grid-cols-5 md:gap-6",
        dirty ? "bg-primary/5" : "",
      )}
      data-config-key={field.key}
    >
      <div className="flex min-w-0 flex-col gap-1 md:col-span-2">
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {field.label}
        </label>
        <code className="break-all font-mono text-xs text-muted-foreground">{field.key}</code>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <StatusDot tone={dirty ? "brand" : copy.tone} className="text-xs text-muted-foreground">
            {entry.cleared ? "Will be removed" : dirty ? "Edited — not saved" : copy.label}
          </StatusDot>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 md:col-span-3">
        {field.envLocked ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            Comes from the deployment environment file. Change it there and restart the services.
          </p>
        ) : (
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              {field.inputKind === "boolean" || (field.inputKind === "select" && field.options) ? (
                <select
                  id={inputId}
                  value={entry.value}
                  disabled={!editable}
                  onChange={(event) => onChange(field.key, event.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={describedBy}
                  data-slot="select-trigger"
                  className={SELECT_CLASS}
                >
                  <option value="">Not set</option>
                  {field.inputKind === "boolean" ? (
                    <>
                      <option value="true">On</option>
                      <option value="false">Off</option>
                    </>
                  ) : (
                    field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))
                  )}
                </select>
              ) : (
                <Input
                  id={inputId}
                  type={field.inputKind === "secret" ? "password" : "text"}
                  value={entry.value}
                  disabled={!editable}
                  placeholder={placeholder}
                  onChange={(event) => onChange(field.key, event.target.value)}
                  autoComplete={field.inputKind === "secret" ? "new-password" : "off"}
                  spellCheck={false}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={describedBy}
                  className="font-mono"
                />
              )}
            </div>
            {editable && dirty ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onUndo(field.key)}
                aria-label={`Undo changes to ${field.label}`}
                title="Undo"
              >
                <RotateCcw aria-hidden />
              </Button>
            ) : editable && hasSaved ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onClear(field.key)}
                aria-label={`Remove saved value for ${field.label}`}
                title="Remove saved value"
              >
                <Trash2 aria-hidden />
              </Button>
            ) : null}
          </div>
        )}
        {error ? (
          <p id={`${inputId}-error`} className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {field.hint ? (
          <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
            {field.hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export const OpsConfigFieldRow = memo(OpsConfigFieldRowImpl);
