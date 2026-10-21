"use client";

import { useState } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { OpsOtpDialog } from "@/components/ops/OpsOtpDialog";
import { useOpsCanWrite, useOpsLoadShed } from "@/components/ops/OpsSessionProvider";
import {
  OpsField,
  OpsLinesSkeleton,
  OpsReadOnlyNotice,
  formatClock,
  formatRelativeTime,
  useSecondsUntil,
} from "@/components/ops/ui/ops-ui";
import { ConsolePage, KeyValueList, Notice, PageHeader, Panel, StatusDot, StickyActions } from "@/components/ui/console";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  LOAD_SHED_MODE_DESCRIPTIONS,
  LOAD_SHED_MODE_LABELS,
  loadShedLabel,
  loadShedTone,
} from "@/lib/ops-status-maps";
import { setOpsLoadShedMode, type OpsLoadShedMode, type OpsLoadShedStatus } from "@/lib/ops-client-api";

const MODES: OpsLoadShedMode[] = ["normal", "reduced", "emergency", "maintenance"];
const REASON_MIN = 10;
const REASON_MAX = 500;

export function OpsLoadShedPanel() {
  const canWrite = useOpsCanWrite();
  const { loadShed, refreshLoadShed } = useOpsLoadShed();
  const [targetMode, setTargetMode] = useState<OpsLoadShedMode | null>(null);
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const selected = targetMode ?? loadShed?.mode ?? "normal";
  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= REASON_MIN;
  const reasonError =
    reasonTouched && !reasonValid ? `Write at least ${REASON_MIN} characters so the audit log explains the change.` : null;

  function openConfirm() {
    setReasonTouched(true);
    setResult(null);
    if (!reasonValid) {
      document.getElementById("load-shed-reason")?.focus();
      return;
    }
    setDialogOpen(true);
  }

  return (
    <ConsolePage className="max-w-4xl">
      <PageHeader
        title="Traffic mode"
        description="Shed load to protect checkout, or take the store offline for planned work."
      />

      <CurrentModePanel status={loadShed} />

      {result ? (
        <Notice tone="success" icon={CircleCheck}>
          {result}
        </Notice>
      ) : null}

      {!canWrite ? (
        <OpsReadOnlyNotice>Changing the traffic mode needs write access (ops:write).</OpsReadOnlyNotice>
      ) : (
        <Panel title="Change mode" description="Applies as soon as you confirm with the code we email you.">
          <form
            className="flex min-w-0 flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              openConfirm();
            }}
            noValidate
          >
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="mb-2 text-sm font-medium text-foreground">Mode</legend>
              {MODES.map((mode) => {
                const isCurrent = loadShed?.mode === mode;
                const checked = selected === mode;
                return (
                  <label
                    key={mode}
                    className={cn(
                      "flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors",
                      checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <input
                      type="radio"
                      name="load-shed-mode"
                      value={mode}
                      checked={checked}
                      onChange={() => setTargetMode(mode)}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-foreground">
                        <StatusDot tone={loadShedTone(mode)}>{LOAD_SHED_MODE_LABELS[mode]}</StatusDot>
                        {isCurrent ? <span className="text-xs font-normal text-muted-foreground">Current</span> : null}
                      </span>
                      <span className="text-sm text-muted-foreground">{LOAD_SHED_MODE_DESCRIPTIONS[mode]}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <OpsField
              label="Reason"
              htmlFor="load-shed-reason"
              hint="Recorded in the audit log and shown to other operators."
              error={reasonError}
            >
              <Textarea
                id="load-shed-reason"
                value={reason}
                maxLength={REASON_MAX}
                onChange={(event) => setReason(event.target.value)}
                onBlur={() => setReasonTouched(true)}
                placeholder="e.g. Payment provider outage — pausing checkout until resolved"
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={reasonError ? "load-shed-reason-error" : "load-shed-reason-hint"}
                rows={3}
              />
              <p className="text-right text-xs text-muted-foreground tabular">
                {trimmedReason.length}/{REASON_MAX}
              </p>
            </OpsField>

            <StickyActions>
              <Button type="submit" variant={selected === "maintenance" || selected === "emergency" ? "destructive" : "default"}>
                {selected === loadShed?.mode ? `Re-apply ${LOAD_SHED_MODE_LABELS[selected].toLowerCase()} mode` : `Switch to ${LOAD_SHED_MODE_LABELS[selected].toLowerCase()}`}
              </Button>
            </StickyActions>
          </form>
        </Panel>
      )}

      <OpsOtpDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action="load-shed-change"
        title={`Switch to ${LOAD_SHED_MODE_LABELS[selected].toLowerCase()} mode?`}
        description={LOAD_SHED_MODE_DESCRIPTIONS[selected]}
        confirmLabel="Change mode"
        tone={selected === "maintenance" || selected === "emergency" ? "danger" : "default"}
        onConfirm={async ({ challengeId, otpCode }) => {
          const response = await setOpsLoadShedMode({ mode: selected, reason: trimmedReason, challengeId, otpCode });
          await refreshLoadShed();
          setTargetMode(null);
          setReason("");
          setReasonTouched(false);
          setResult(
            response.mode === "maintenance" && response.phase === "pending"
              ? "Maintenance starts in 2 minutes. Shoppers see a countdown banner now."
              : response.updated
                ? `Traffic mode is now ${LOAD_SHED_MODE_LABELS[response.mode].toLowerCase()}.`
                : `Traffic mode was already ${LOAD_SHED_MODE_LABELS[response.mode].toLowerCase()} — nothing changed.`,
          );
        }}
      >
        <KeyValueList
          items={[
            { label: "From", value: loadShed ? loadShedLabel(loadShed) : "—" },
            { label: "To", value: LOAD_SHED_MODE_LABELS[selected] },
            { label: "Reason", value: trimmedReason, wide: true },
          ]}
        />
        {selected === "maintenance" ? (
          <Notice tone="warning" icon={TriangleAlert}>
            New checkouts stop immediately. After 2 minutes the storefront and merchant admin show the maintenance page
            until you switch back.
          </Notice>
        ) : null}
      </OpsOtpDialog>
    </ConsolePage>
  );
}

function CurrentModePanel({ status }: { status: OpsLoadShedStatus | null }) {
  const seconds = useSecondsUntil(status?.mode === "maintenance" && status.phase === "pending" ? status.pendingUntil : null);

  return (
    <Panel title="Current mode">
      {!status ? (
        <OpsLinesSkeleton lines={2} />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <StatusDot tone={loadShedTone(status.mode)} className="text-xl font-semibold">
              {loadShedLabel(status)}
            </StatusDot>
            <p className="text-sm text-muted-foreground">{LOAD_SHED_MODE_DESCRIPTIONS[status.mode]}</p>
          </div>
          {status.mode === "maintenance" && status.phase === "pending" ? (
            <Notice tone="warning" icon={TriangleAlert} title={`Storefront goes offline in ${seconds != null ? formatClock(seconds) : "a moment"}`}>
              In-flight payments are finishing and new checkouts are blocked. Switch to another mode before the timer ends to cancel.
            </Notice>
          ) : null}
          {status.mode === "maintenance" && status.phase === "active" ? (
            <Notice tone="danger" icon={TriangleAlert} title="The store is offline">
              Shoppers and merchant admins see the maintenance page. Ops and payment webhooks still work. Switch to normal to
              reopen.
            </Notice>
          ) : null}
          {status.activatedAt || status.reason ? (
            <KeyValueList
              items={[
                ...(status.activatedAt ? [{ label: "Since", value: formatRelativeTime(status.activatedAt) }] : []),
                ...(status.reason ? [{ label: "Last reason", value: status.reason }] : []),
              ]}
            />
          ) : null}
        </div>
      )}
    </Panel>
  );
}
