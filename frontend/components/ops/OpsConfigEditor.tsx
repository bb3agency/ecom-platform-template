"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, KeyRound, Package, RotateCcw, Trash2 } from "lucide-react";
import { useOpsCanWrite } from "@/components/ops/OpsSessionProvider";
import {
  OpsAlert,
  OpsBadge,
  OpsCard,
  OpsCardHeader,
  OpsField,
  OpsInput,
  OpsSelect,
} from "@/components/ops/ui/ops-ui";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  getApiErrorMessageWithHint,
  getOpsErrorDetail,
  isOpsOtpChallengeConsumed,
} from "@/lib/error-messages";
import { isCompleteOtpCode, normalizeOtpCodeInput } from "@/lib/otp-code";
import {
  buildOpsConfigFieldDefinitions,
  groupOpsConfigFieldsByDomain,
  type OpsConfigFieldDefinition,
} from "@/lib/ops-config-fields";
import {
  requestOpsOtpChallenge,
  saveOpsConfigClient,
  validateOpsConfigClient,
  type OpsConfigOverview,
  type OpsStoredConfig,
} from "@/lib/ops-client-api";

interface OpsConfigEditorProps {
  overview: OpsConfigOverview;
  stored: OpsStoredConfig;
  onConfigSaved?: () => void;
}

type DraftEntry = {
  value: string;
  touched: boolean;
  cleared: boolean;
};

function buildInitialDraft(fields: OpsConfigFieldDefinition[]): Record<string, DraftEntry> {
  const draft: Record<string, DraftEntry> = {};
  for (const field of fields) {
    // Prefill every key with its currently stored plaintext value — including
    // real secrets like RAZORPAY_KEY_SECRET, SHIPROCKET_PASSWORD, RESEND_API_KEY.
    // The Ops console is platform-operator-only (ops login + email OTP for
    // writes, fail-closed permissions, tamper-evident audit chain) so the
    // operator deliberately gets full visibility into the saved values
    // instead of having to keep an external vault in sync to know what was
    // last persisted. Secret-typed inputs (see field.inputKind === "secret"
    // below) still render as <input type="password"> with an eye-toggle, so
    // the rendered DOM stays bullet-masked until the operator opts to peek.
    // `touched: false` keeps the field out of the dirty diff until the user
    // actually changes it, so re-saving is a true no-op.
    const prefill = field.storedPlaintext ?? "";
    draft[field.key] = { value: prefill, touched: false, cleared: false };
  }
  return draft;
}

interface OpsConfigFieldRowProps {
  field: OpsConfigFieldDefinition;
  entry: DraftEntry;
  canWrite: boolean;
  onChange: (key: string, value: string) => void;
  onClear: (key: string) => void;
}

function OpsConfigFieldRow({
  field,
  entry,
  canWrite,
  onChange,
  onClear,
}: OpsConfigFieldRowProps) {
  const [showSecret, setShowSecret] = useState(false);
  const hasStoredValue = Boolean(field.storedMasked);
  const isDirty = entry.touched || entry.cleared;
  const canEditField = canWrite && !field.envLocked;

  return (
    <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/15 p-4 sm:grid-cols-[minmax(0,220px)_1fr_auto] sm:items-start sm:gap-4">
      <div className="grid gap-1">
        <code className="text-xs font-medium text-foreground">{field.key}</code>
        <p className="text-xs text-muted-foreground">{field.label}</p>
        <div className="flex flex-wrap gap-1">
          {field.present && hasStoredValue ? (
            <OpsBadge tone="success">Runtime present (DB overlay)</OpsBadge>
          ) : field.present ? (
            <OpsBadge tone="success">Runtime present (env file)</OpsBadge>
          ) : hasStoredValue ? (
            <OpsBadge tone="warning">Saved — restart pending</OpsBadge>
          ) : (
            <OpsBadge tone="danger">Missing</OpsBadge>
          )}
          {field.envLocked ? <OpsBadge tone="muted">Managed via env file</OpsBadge> : null}
          {field.requiresRestart ? <OpsBadge tone="muted">Restart required</OpsBadge> : null}
          {isDirty ? <OpsBadge tone="warning">Unsaved</OpsBadge> : null}
        </div>
      </div>

      <div className="grid gap-2">
        {field.envLocked ? (
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Runtime value is currently sourced from environment. Edit the deployment env file and
            restart services to change this key.
          </div>
        ) : field.inputKind === "boolean" ? (
          <OpsSelect
            id={`config-${field.key}`}
            value={entry.value}
            disabled={!canEditField}
            onChange={(event) => onChange(field.key, event.target.value)}
          >
            <option value="">— Select —</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </OpsSelect>
        ) : field.inputKind === "select" && field.options ? (
          <OpsSelect
            id={`config-${field.key}`}
            value={entry.value}
            disabled={!canEditField}
            onChange={(event) => onChange(field.key, event.target.value)}
          >
            <option value="">— Select —</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </OpsSelect>
        ) : (
          <div className="relative">
            <OpsInput
              id={`config-${field.key}`}
              type={field.inputKind === "secret" && !showSecret ? "password" : "text"}
              value={entry.value}
              disabled={!canEditField}
              placeholder={
                entry.cleared
                  ? "Will remove stored value on save"
                  : "Enter value"
              }
              onChange={(event) => onChange(field.key, event.target.value)}
              className={field.inputKind === "secret" ? "pr-10 font-mono text-xs" : "font-mono text-xs"}
              autoComplete="off"
            />
            {field.inputKind === "secret" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-1/2 right-1 size-8 -translate-y-1/2"
                onClick={() => setShowSecret((prev) => !prev)}
                aria-label={showSecret ? "Hide value" : "Show value"}
              >
                {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            ) : null}
          </div>
        )}
        {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
      </div>

      <div className="flex gap-2 sm:justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canEditField || (!entry.value && !hasStoredValue && !entry.cleared)}
          onClick={() => onClear(field.key)}
          className="gap-1"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Clear
        </Button>
      </div>
    </div>
  );
}

function ShippingModeStatus({ overview }: { overview: OpsConfigOverview }) {
  const shippingDomain = overview.domains.find((d) => d.domain === "shipping");
  const itemMap = new Map(shippingDomain?.items.map((i) => [i.key, i]) ?? []);

  const hasDelhivery = Boolean(itemMap.get("DELHIVERY_API_KEY")?.present);
  const hasShiprocket =
    Boolean(itemMap.get("SHIPROCKET_EMAIL")?.present) &&
    Boolean(itemMap.get("SHIPROCKET_PASSWORD")?.present);

  const isDual = hasDelhivery && hasShiprocket;
  const hasAny = hasDelhivery || hasShiprocket;

  const label = isDual
    ? "Dual-provider mode active"
    : hasDelhivery
      ? "Single-provider mode: Delhivery"
      : hasShiprocket
        ? "Single-provider mode: Shiprocket"
        : "No shipping provider configured";

  const description = isDual
    ? "Both Delhivery and Shiprocket are configured. At checkout the system queries both in parallel and assigns each order to the cheaper provider automatically. No manual selection needed."
    : hasAny
      ? "One provider is configured. Configure credentials for the second provider below to enable dual-provider mode."
      : "Neither Delhivery nor Shiprocket credentials are present. Customers cannot get delivery rates at checkout until credentials are saved and the API is restarted.";

  const tone = isDual ? "border-green-500/30 bg-green-500/10 text-green-800" : hasAny ? "border-amber-500/30 bg-amber-500/10 text-amber-800" : "border-destructive/30 bg-destructive/10 text-destructive";

  return (
    <div className={`flex items-start gap-3 rounded-lg border p-4 ${tone}`}>
      <Package className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="grid gap-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs">{description}</p>
        <div className="mt-1 flex gap-3 text-xs">
          <span className={`flex items-center gap-1.5 ${hasDelhivery ? "font-medium" : "opacity-60"}`}>
            <span className={`inline-block size-2 rounded-full ${hasDelhivery ? "bg-green-500" : "bg-current opacity-30"}`} />
            Delhivery {hasDelhivery ? "✓" : "—"}
          </span>
          <span className={`flex items-center gap-1.5 ${hasShiprocket ? "font-medium" : "opacity-60"}`}>
            <span className={`inline-block size-2 rounded-full ${hasShiprocket ? "bg-green-500" : "bg-current opacity-30"}`} />
            Shiprocket {hasShiprocket ? "✓" : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function OpsConfigEditor({ overview, stored, onConfigSaved }: OpsConfigEditorProps) {
  const canWrite = useOpsCanWrite();
  const fields = useMemo(
    () => buildOpsConfigFieldDefinitions(overview, stored),
    [overview, stored],
  );
  const sections = useMemo(() => groupOpsConfigFieldsByDomain(fields), [fields]);

  const [draft, setDraft] = useState<Record<string, DraftEntry>>(() => buildInitialDraft(fields));
  const [trackedFields, setTrackedFields] = useState(fields);
  const [challengeId, setChallengeId] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Derived-state-during-render pattern (React docs: "Storing information
  // from previous renders"): when the parent passes a fresh `fields` array
  // — e.g. after a successful save triggers a refetch of overview + stored
  // config — reset the draft to the new prefills so the editor reflects the
  // newly saved values and clears any leftover unsaved edits. Doing this in
  // a useEffect would trigger react-hooks/set-state-in-effect and cause a
  // cascading render. Setting state directly during render is the
  // React-recommended replacement.
  if (fields !== trackedFields) {
    setTrackedFields(fields);
    setDraft(buildInitialDraft(fields));
  }

  useEffect(() => {
    if (!expiresAt) {
      return;
    }
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const dirtyValues = useMemo(() => {
    const values: Record<string, string | null> = {};
    for (const field of fields) {
      const entry = draft[field.key];
      if (!entry) {
        continue;
      }
      if (entry.cleared) {
        values[field.key] = null;
        continue;
      }
      if (entry.touched && entry.value.trim()) {
        values[field.key] = entry.value.trim();
      }
    }
    return values;
  }, [draft, fields]);

  const dirtyCount = Object.keys(dirtyValues).length;

  const handleChange = useCallback((key: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      [key]: {
        value,
        touched: true,
        cleared: false,
      },
    }));
  }, []);

  const handleClear = useCallback((key: string) => {
    setDraft((prev) => ({
      ...prev,
      [key]: {
        value: "",
        touched: true,
        cleared: true,
      },
    }));
  }, []);

  const resetDraft = useCallback(() => {
    setDraft(buildInitialDraft(fields));
    setOtpCode("");
    setChallengeId("");
    setExpiresAt(null);
    setError(null);
    setErrorDetail(null);
    setMessage(null);
  }, [fields]);

  async function handleRequestOtp() {
    setError(null);
    setErrorDetail(null);
    setMessage(null);
    setIsLoading(true);
    try {
      const challenge = await requestOpsOtpChallenge("config-save");
      setChallengeId(challenge.challengeId);
      setExpiresAt(challenge.expiresAt);
      setMessage("A 6-digit code was sent to your ops email.");
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
      setErrorDetail(getOpsErrorDetail(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function executeSave() {
    if (!canWrite) {
      return;
    }
    if (dirtyCount === 0) {
      setError("Change at least one field before saving.");
      return;
    }

    if (!challengeId) {
      await handleRequestOtp();
      return;
    }

    if (!isCompleteOtpCode(otpCode)) {
      setError("Enter the 6-digit OTP sent to your email.");
      setErrorDetail(null);
      return;
    }
    if (secondsLeft <= 0) {
      setError("OTP expired. Request a new code.");
      return;
    }

    setError(null);
    setErrorDetail(null);
    setMessage(null);
    setIsLoading(true);
    try {
      const normalizedOtp = normalizeOtpCodeInput(otpCode);
      const validation = await validateOpsConfigClient({ values: dirtyValues });
      if (!validation.valid) {
        setError(
          validation.errors.map((issue) => `${issue.key}: ${issue.message}`).join(" · ") ||
            "Configuration validation failed.",
        );
        return;
      }

      const result = await saveOpsConfigClient({
        values: dirtyValues,
        challengeId,
        otpCode: normalizedOtp,
      });
      setDraft(buildInitialDraft(fields));
      setOtpCode("");
      setChallengeId("");
      setExpiresAt(null);
      setMessage(
        result.requiresRestart
          ? `Saved ${result.savedKeys.length} key(s) to the database. Restart the API and workers next — there is no automatic popup; use Ops → System or SSH on the VPS.`
          : `Saved ${result.savedKeys.length} key(s) to the database.`,
      );
      onConfigSaved?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS" && isOpsOtpChallengeConsumed(err)) {
        setError(getApiErrorMessageWithHint(err));
        setErrorDetail(getOpsErrorDetail(err));
        setChallengeId("");
        setOtpCode("");
        setExpiresAt(null);
        return;
      }
      if (err instanceof ApiError && err.code === "ops_audit_chain_lock_timeout") {
        setError(getApiErrorMessageWithHint(err));
        setErrorDetail(getOpsErrorDetail(err));
        window.setTimeout(() => {
          void executeSave();
        }, 1500);
        return;
      }
      setError(getApiErrorMessageWithHint(err));
      setErrorDetail(getOpsErrorDetail(err));
      if (isOpsOtpChallengeConsumed(err)) {
        setChallengeId("");
        setOtpCode("");
        setExpiresAt(null);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    await executeSave();
  }

  if (!canWrite) {
    return (
      <OpsAlert tone="warning">
        Read-only session — configuration changes require ops:write.
      </OpsAlert>
    );
  }

  return (
    <form onSubmit={handleSave} className="grid gap-8">
      {sections.map((section) => (
        <OpsCard key={section.domain}>
          <OpsCardHeader
            title={section.label}
            description="DB-overlay keys — variable name is fixed; edit the value column."
          />
          <div className="grid gap-3">
            {section.domain === "shipping" ? (
              <ShippingModeStatus overview={overview} />
            ) : null}
            {section.fields.map((field) => (
              <OpsConfigFieldRow
                key={field.key}
                field={field}
                entry={draft[field.key] ?? { value: "", touched: false, cleared: false }}
                canWrite={canWrite}
                onChange={handleChange}
                onClear={handleClear}
              />
            ))}
          </div>
        </OpsCard>
      ))}

      <OpsCard className="border-primary/25 bg-primary/5">
        <OpsCardHeader
          title="Save configuration"
          description="Sends an OTP to your ops email, then encrypts and stores changed keys in the database."
          actions={
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="size-5" aria-hidden />
            </div>
          }
        />

        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            {dirtyCount > 0
              ? `${dirtyCount} unsaved change(s) ready to persist.`
              : "Edit values above, then save."}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetDraft}
              disabled={isLoading || dirtyCount === 0}
              className="gap-1"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Reset changes
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleRequestOtp()}
              disabled={isLoading}
            >
              {challengeId && secondsLeft > 0 ? "Resend OTP" : "Send OTP to email"}
            </Button>
            {challengeId && secondsLeft > 0 ? (
              <span className="self-center text-xs text-muted-foreground" role="status">
                OTP expires in {secondsLeft}s
              </span>
            ) : null}
          </div>

          <OpsField label="Verification code" htmlFor="ops-config-otp">
            <OpsInput
              id="ops-config-otp"
              value={otpCode}
              onChange={(event) => setOtpCode(normalizeOtpCodeInput(event.target.value))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="max-w-xs tracking-[0.3em]"
            />
          </OpsField>

          <Button type="submit" disabled={isLoading || dirtyCount === 0} className="w-fit">
            {isLoading
              ? "Working…"
              : challengeId
                ? "Verify OTP and save to database"
                : "Save — send OTP first"}
          </Button>

          {message ? <OpsAlert tone="success">{message}</OpsAlert> : null}
          {error ? (
            <OpsAlert tone="error">
              <div className="grid gap-1">
                <span>{error}</span>
                {errorDetail ? (
                  <span className="font-mono text-xs text-destructive/80">{errorDetail}</span>
                ) : null}
              </div>
            </OpsAlert>
          ) : null}

          <OpsAlert tone="info" title="Restart is manual">
            Saved keys stay in the database until the running API and workers reload them. There is
            no in-app restart prompt after save — go to{" "}
            <Link href="/ops/system" className="font-medium underline underline-offset-2">
              Ops → System
            </Link>{" "}
            (OTP + optional delay) or restart containers on the VPS (for example{" "}
            <code className="text-xs">docker compose up -d backend workers</code>).
          </OpsAlert>
        </div>
      </OpsCard>
    </form>
  );
}
