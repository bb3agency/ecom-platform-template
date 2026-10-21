"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, Lock, TriangleAlert } from "lucide-react";
import { OpsConfigEditor, type OpsConfigShowFilter } from "@/components/ops/OpsConfigEditor";
import { useOpsCanWrite } from "@/components/ops/OpsSessionProvider";
import { OpsLinesSkeleton, OpsLoadError, OpsReadOnlyNotice } from "@/components/ops/ui/ops-ui";
import { ConsolePage, Notice, PageHeader, Panel, StatusDot } from "@/components/ui/console";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { formatPrice } from "@/lib/format-price";
import {
  getOpsConfigOverviewClient,
  getOpsStoredConfigClient,
  getWhatsappOtpCostClient,
  type OpsConfigOverview,
  type OpsConfigSaveResponse,
  type OpsStoredConfig,
  type WhatsappOtpCostEstimate,
} from "@/lib/ops-client-api";

interface OpsConfigPagePanelProps {
  initialShow?: OpsConfigShowFilter;
}

function whatsappNote(cost: WhatsappOtpCostEstimate | null): string | undefined {
  if (!cost) return undefined;
  return `WhatsApp OTPs this billing cycle: ${cost.currentCycle.count} sent, about ${formatPrice(cost.currentCycle.costPaise)} (${formatPrice(cost.costPerMessagePaise)} each).`;
}

export function OpsConfigPagePanel({ initialShow = "all" }: OpsConfigPagePanelProps) {
  const canWrite = useOpsCanWrite();
  const [overview, setOverview] = useState<OpsConfigOverview | null>(null);
  const [stored, setStored] = useState<OpsStoredConfig | null>(null);
  const [whatsappCost, setWhatsappCost] = useState<WhatsappOtpCostEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<OpsConfigSaveResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextOverview, nextStored] = await Promise.all([getOpsConfigOverviewClient(), getOpsStoredConfigClient()]);
      setOverview(nextOverview);
      setStored(nextStored);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setLoading(false);
    }
    // Best effort — never blocks the page.
    getWhatsappOtpCostClient()
      .then(setWhatsappCost)
      .catch(() => setWhatsappCost(null));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const restartKeys = overview?.domains.flatMap((d) => d.items.filter((i) => i.restartPending).map((i) => i.key)) ?? [];
  const missingKeys = overview?.strictProfileHealth.missingRequiredKeysInStrict ?? [];

  return (
    <ConsolePage>
      <PageHeader
        title="Configuration"
        description="Provider keys and runtime settings, stored encrypted. Saved changes apply after a restart."
        meta={
          overview ? (
            <StatusDot tone={overview.runtimeProfile === "production-like" ? "info" : "warning"} className="text-muted-foreground">
              {overview.runtimeProfile === "production-like" ? "Production profile" : "Development profile"}
            </StatusDot>
          ) : null
        }
      />

      {saved ? (
        <Notice
          tone="success"
          icon={CircleCheck}
          title={`Saved ${saved.savedKeys.length} ${saved.savedKeys.length === 1 ? "setting" : "settings"}`}
          action={
            saved.requiresRestart ? (
              <Link href="/ops/system" className="text-sm font-medium text-primary hover:underline">
                Schedule restart
              </Link>
            ) : undefined
          }
        >
          {saved.requiresRestart
            ? "They're stored but not live yet. Restart the API and workers to apply them."
            : "They're live now."}
        </Notice>
      ) : null}

      {missingKeys.length > 0 ? (
        <Notice tone="danger" icon={TriangleAlert} title="Required settings are missing">
          The API won&apos;t serve traffic in production until these are set:{" "}
          <span className="break-words font-mono text-foreground">{missingKeys.join(", ")}</span>
        </Notice>
      ) : null}
      {restartKeys.length > 0 && !saved ? (
        <Notice
          tone="warning"
          title={`${restartKeys.length} saved ${restartKeys.length === 1 ? "setting isn't" : "settings aren't"} live yet`}
          action={
            <Link href="/ops/system" className="text-sm font-medium text-primary hover:underline">
              Schedule restart
            </Link>
          }
        >
          The running API still uses the previous values until it restarts.
        </Notice>
      ) : null}
      {!canWrite ? <OpsReadOnlyNotice>Changing settings needs write access (ops:write).</OpsReadOnlyNotice> : null}

      {error && !overview ? <OpsLoadError message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <Panel>
          <OpsLinesSkeleton lines={6} />
        </Panel>
      ) : overview && stored ? (
        <OpsConfigEditor
          overview={overview}
          stored={stored}
          initialShow={initialShow}
          sectionNotes={{ notifications: whatsappNote(whatsappCost) }}
          onSaved={(result) => {
            setSaved(result);
            void load();
          }}
        />
      ) : null}

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Database URL, initial Redis URL and the encryption key are bootstrap settings: they live in the server&apos;s
          environment file and can&apos;t be changed here. Saved secrets are hidden until you click the eye icon next to them.
        </span>
      </p>
    </ConsolePage>
  );
}
