"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { OpsOtpDialog } from "@/components/ops/OpsOtpDialog";
import { OpsServiceHealthPanel } from "@/components/ops/OpsServiceHealthPanel";
import { useOpsCanWrite } from "@/components/ops/OpsSessionProvider";
import { useOpsOverview } from "@/components/ops/use-ops-overview";
import { OpsField, OpsLinesSkeleton, OpsReadOnlyNotice } from "@/components/ops/ui/ops-ui";
import { ConsolePage, KeyValueList, Notice, PageHeader, Panel, StickyActions } from "@/components/ui/console";
import { Button } from "@/components/ui/button";
import { formatOpsDateTime } from "@/lib/ops-format";
import { scheduleOpsSystemRestart } from "@/lib/ops-client-api";

const DELAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Now" },
  { value: 5, label: "In 5 minutes" },
  { value: 15, label: "In 15 minutes" },
  { value: 30, label: "In 30 minutes" },
  { value: 60, label: "In 1 hour" },
  { value: 240, label: "In 4 hours" },
  { value: 1440, label: "In 24 hours" },
];

export function OpsSystemPanel() {
  const canWrite = useOpsCanWrite();
  const { overview, loading } = useOpsOverview();
  const [delayMinutes, setDelayMinutes] = useState(5);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const pendingKeys = overview?.config.restartPendingKeys ?? [];
  const delayLabel = DELAY_OPTIONS.find((o) => o.value === delayMinutes)?.label.toLowerCase() ?? `in ${delayMinutes} minutes`;

  return (
    <ConsolePage className="max-w-5xl">
      <PageHeader
        title="Restart"
        description="Restart the API and workers to load saved settings or recover a stuck process."
      />

      {scheduledFor ? (
        <Notice tone="success" icon={CircleCheck} title="Restart scheduled">
          API and workers restart at {formatOpsDateTime(scheduledFor)}. Checkout pauses briefly while in-flight payments finish.
        </Notice>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 items-start gap-5 sm:gap-6 lg:grid-cols-5">
        <div className="flex min-w-0 flex-col gap-5 sm:gap-6 lg:col-span-3">
          <Panel title="Settings waiting for a restart">
            {loading ? (
              <OpsLinesSkeleton lines={2} />
            ) : pendingKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">None — the running API already uses every saved setting.</p>
            ) : (
              <div className="flex min-w-0 flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  These were saved in{" "}
                  <Link href="/ops/config?show=restart" className="font-medium text-primary hover:underline">
                    Configuration
                  </Link>{" "}
                  but the running API still uses the old values.
                </p>
                <ul className="flex min-w-0 flex-wrap gap-1.5">
                  {pendingKeys.map((key) => (
                    <li key={key} className="max-w-full break-all rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
                      {key}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          {!canWrite ? (
            <OpsReadOnlyNotice>Scheduling a restart needs write access (ops:write).</OpsReadOnlyNotice>
          ) : (
            <Panel title="Schedule a restart" description="Payment-safe: the API drains in-flight prepaid orders first.">
              <form
                className="flex min-w-0 flex-col gap-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  setScheduledFor(null);
                  setDialogOpen(true);
                }}
              >
                <OpsField
                  label="When"
                  htmlFor="restart-delay"
                  hint="During the restart window traffic switches to emergency mode, so checkout is briefly unavailable."
                >
                  <select
                    id="restart-delay"
                    value={delayMinutes}
                    onChange={(event) => setDelayMinutes(Number(event.target.value))}
                    aria-describedby="restart-delay-hint"
                    data-slot="select-trigger"
                    className="console-select h-9 w-full max-w-xs appearance-none rounded-lg border border-input bg-card pl-3 pr-8 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    {DELAY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </OpsField>
                <StickyActions>
                  <Button type="submit" variant="destructive">
                    Schedule restart
                  </Button>
                </StickyActions>
              </form>
            </Panel>
          )}
        </div>
        <OpsServiceHealthPanel className="lg:col-span-2" />
      </div>

      <OpsOtpDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action="system-restart"
        title="Restart the API and workers?"
        description={`Restart ${delayLabel}. Checkout pauses for a moment while in-flight payments finish.`}
        confirmLabel="Schedule restart"
        tone="danger"
        onConfirm={async ({ challengeId, otpCode }) => {
          const response = await scheduleOpsSystemRestart({ delayMinutes, challengeId, otpCode });
          setScheduledFor(response.scheduledFor);
        }}
      >
        <KeyValueList
          items={[
            { label: "When", value: DELAY_OPTIONS.find((o) => o.value === delayMinutes)?.label ?? `${delayMinutes} min` },
            { label: "Settings applied", value: pendingKeys.length > 0 ? `${pendingKeys.length} waiting` : "None waiting" },
          ]}
        />
      </OpsOtpDialog>
    </ConsolePage>
  );
}
