"use client";

import { useCallback, useMemo, useState } from "react";
import { OpsConfigFieldRow, configFieldState, type OpsConfigDraftEntry } from "@/components/ops/OpsConfigFieldRow";
import { OpsOtpDialog } from "@/components/ops/OpsOtpDialog";
import { OpsShippingModeNotice } from "@/components/ops/OpsShippingModeNotice";
import { useOpsCanWrite } from "@/components/ops/OpsSessionProvider";
import { FilterBar, FilterSelect, Notice, Panel } from "@/components/ui/console";
import { Button } from "@/components/ui/button";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import {
  buildOpsConfigFieldDefinitions,
  groupOpsConfigFieldsByDomain,
  type OpsConfigFieldDefinition,
} from "@/lib/ops-config-fields";
import {
  saveOpsConfigClient,
  validateOpsConfigClient,
  type OpsConfigOverview,
  type OpsConfigSaveResponse,
  type OpsStoredConfig,
} from "@/lib/ops-client-api";

export type OpsConfigShowFilter = "all" | "missing" | "restart" | "edited";

const SHOW_OPTIONS: Array<{ value: OpsConfigShowFilter; label: string }> = [
  { value: "all", label: "All settings" },
  { value: "missing", label: "Not set" },
  { value: "restart", label: "Waiting for restart" },
  { value: "edited", label: "Edited" },
];

interface OpsConfigEditorProps {
  overview: OpsConfigOverview;
  stored: OpsStoredConfig;
  initialShow?: OpsConfigShowFilter;
  /** Extra line under a section title, e.g. WhatsApp cost under Notifications. */
  sectionNotes?: Partial<Record<string, string>>;
  onSaved: (result: OpsConfigSaveResponse) => void;
}

function buildInitialDraft(fields: OpsConfigFieldDefinition[]): Record<string, OpsConfigDraftEntry> {
  const draft: Record<string, OpsConfigDraftEntry> = {};
  for (const field of fields) {
    // Every field starts from the saved value (secrets too — they render as a
    // password input with a reveal toggle). Untouched means "keep".
    draft[field.key] = { value: field.storedPlaintext ?? "", touched: false, cleared: false };
  }
  return draft;
}

export function OpsConfigEditor({ overview, stored, initialShow = "all", sectionNotes, onSaved }: OpsConfigEditorProps) {
  const canWrite = useOpsCanWrite();
  const fields = useMemo(() => buildOpsConfigFieldDefinitions(overview, stored), [overview, stored]);
  const [draft, setDraft] = useState(() => buildInitialDraft(fields));
  const [trackedFields, setTrackedFields] = useState(fields);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<OpsConfigShowFilter>(initialShow);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [validating, setValidating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // New data after a save: reset the draft during render (not in an effect).
  if (fields !== trackedFields) {
    setTrackedFields(fields);
    setDraft(buildInitialDraft(fields));
  }

  const dirtyValues = useMemo(() => {
    const values: Record<string, string | null> = {};
    for (const field of fields) {
      const entry = draft[field.key];
      if (!entry) continue;
      if (entry.cleared) values[field.key] = null;
      else if (entry.touched && entry.value.trim() && entry.value.trim() !== (field.storedPlaintext ?? "")) {
        values[field.key] = entry.value.trim();
      }
    }
    return values;
  }, [draft, fields]);
  const dirtyKeys = Object.keys(dirtyValues);
  const dirtyCount = dirtyKeys.length;

  const handleChange = useCallback((key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: { value, touched: true, cleared: false } }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);
  const handleClear = useCallback((key: string) => {
    setDraft((prev) => ({ ...prev, [key]: { value: "", touched: true, cleared: true } }));
  }, []);
  const handleUndo = useCallback(
    (key: string) => {
      const field = fields.find((f) => f.key === key);
      setDraft((prev) => ({ ...prev, [key]: { value: field?.storedPlaintext ?? "", touched: false, cleared: false } }));
    },
    [fields],
  );

  function discard() {
    setDraft(buildInitialDraft(fields));
    setFieldErrors({});
    setFormError(null);
    setWarnings([]);
  }

  async function reviewAndSave() {
    setFormError(null);
    setWarnings([]);
    setValidating(true);
    try {
      const validation = await validateOpsConfigClient({ values: dirtyValues });
      if (!validation.valid) {
        const errors: Record<string, string> = {};
        for (const issue of validation.errors) errors[issue.key] = issue.message;
        setFieldErrors(errors);
        setFormError(
          `${validation.errors.length} ${validation.errors.length === 1 ? "setting needs" : "settings need"} fixing before you can save.`,
        );
        const first = validation.errors[0]?.key;
        if (first) document.getElementById(`config-${first}`)?.focus();
        return;
      }
      setFieldErrors({});
      setWarnings(validation.warnings.map((w) => `${w.key}: ${w.message}`));
      setDialogOpen(true);
    } catch (err) {
      setFormError(getApiErrorMessageWithHint(err));
    } finally {
      setValidating(false);
    }
  }

  const q = query.trim().toLowerCase();
  const sections = groupOpsConfigFieldsByDomain(fields)
    .map((section) => ({
      ...section,
      fields: section.fields.filter((field) => {
        if (q && !field.key.toLowerCase().includes(q) && !field.label.toLowerCase().includes(q)) return false;
        const entry = draft[field.key];
        const dirty = Boolean(entry && (entry.touched || entry.cleared));
        if (show === "edited") return dirty;
        if (show === "missing") return configFieldState(field) === "missing";
        if (show === "restart") return configFieldState(field) === "restart";
        return true;
      }),
    }))
    .filter((section) => section.fields.length > 0);

  const fieldByKey = new Map(fields.map((f) => [f.key, f] as const));

  return (
    <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
      <FilterBar search={{ value: query, onChange: setQuery, placeholder: "Search settings", label: "Search settings" }}>
        <FilterSelect
          label="Show"
          value={show}
          onChange={(value) => setShow(value as OpsConfigShowFilter)}
          options={SHOW_OPTIONS}
        />
      </FilterBar>

      {sections.length === 0 ? (
        <Panel>
          <p className="text-sm text-muted-foreground">
            No settings match.{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                setQuery("");
                setShow("all");
              }}
            >
              Show all settings
            </button>
          </p>
        </Panel>
      ) : null}

      {sections.map((section) => (
        <Panel
          key={section.domain}
          title={section.label}
          description={sectionNotes?.[section.domain]}
          flush
          bodyClassName="divide-y divide-border"
        >
          {section.domain === "shipping" && !q && show === "all" ? <OpsShippingModeNotice overview={overview} /> : null}
          {section.fields.map((field) => (
            <OpsConfigFieldRow
              key={field.key}
              field={field}
              entry={draft[field.key] ?? { value: "", touched: false, cleared: false }}
              canWrite={canWrite}
              error={fieldErrors[field.key]}
              onChange={handleChange}
              onClear={handleClear}
              onUndo={handleUndo}
            />
          ))}
        </Panel>
      ))}

      {formError ? <Notice tone="danger">{formError}</Notice> : null}

      {canWrite && (dirtyCount > 0 || formError) ? (
        // Always sticky (not StickyActions, which goes static on desktop): this form is long and
        // edits are scattered, so the save bar must stay in view at every width.
        <div
          className="sticky -bottom-5 z-20 -mx-4 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-card/80 sm:-bottom-6 sm:-mx-6 sm:px-6 lg:-bottom-8 lg:-mx-8 lg:px-8"
          role="region"
          aria-label="Unsaved changes"
        >
          <p className="min-w-0 text-sm text-muted-foreground tabular" aria-live="polite">
            {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" onClick={discard} disabled={validating}>
              Discard
            </Button>
            <Button type="button" onClick={() => void reviewAndSave()} loading={validating} disabled={dirtyCount === 0}>
              Save changes
            </Button>
          </div>
        </div>
      ) : null}

      <OpsOtpDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action="config-save"
        title={`Save ${dirtyCount} ${dirtyCount === 1 ? "setting" : "settings"}?`}
        description="Values are encrypted in the database. The API and workers use them after the next restart."
        confirmLabel="Save settings"
        onConfirm={async ({ challengeId, otpCode }) => {
          const result = await saveOpsConfigClient({ values: dirtyValues, challengeId, otpCode });
          onSaved(result);
        }}
      >
        <ul className="flex min-w-0 flex-col divide-y divide-border rounded-lg border border-border">
          {dirtyKeys.map((key) => {
            const field = fieldByKey.get(key);
            const value = dirtyValues[key];
            return (
              <li key={key} className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
                <span className="text-sm font-medium text-foreground">{field?.label ?? key}</span>
                <span className="break-all font-mono text-xs text-muted-foreground">
                  {value === null ? "Remove saved value" : field?.inputKind === "secret" ? "New secret (hidden)" : value}
                </span>
              </li>
            );
          })}
        </ul>
        {warnings.length > 0 ? (
          <Notice tone="warning" title="Check before saving">
            <ul className="list-disc pl-4">
              {warnings.map((w) => (
                <li key={w} className="break-words">
                  {w}
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}
      </OpsOtpDialog>
    </div>
  );
}
