"use client";

import { useState } from "react";
import { OpsField } from "@/components/ops/ui/ops-ui";
import { Textarea } from "@/components/ui/textarea";

export const REASON_MIN_LENGTH = 10;
const REASON_MAX_LENGTH = 500;

interface OpsReasonFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

/** Audit reason (10–500 characters) used by deactivation dialogs. */
export function OpsReasonField({ id, value, onChange, label = "Reason" }: OpsReasonFieldProps) {
  const [touched, setTouched] = useState(false);
  const length = value.trim().length;
  const error =
    touched && length < REASON_MIN_LENGTH ? `Write at least ${REASON_MIN_LENGTH} characters for the audit log.` : null;
  return (
    <OpsField label={label} htmlFor={id} hint="Saved in the audit log." error={error}>
      <Textarea
        id={id}
        value={value}
        maxLength={REASON_MAX_LENGTH}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        placeholder="e.g. Left the company on 30 Sep"
      />
      <p className="text-right text-xs text-muted-foreground tabular">
        {length}/{REASON_MAX_LENGTH}
      </p>
    </OpsField>
  );
}
