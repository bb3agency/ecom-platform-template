"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AdminFormFieldProps {
  label: ReactNode;
  htmlFor?: string;
  field?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + inline field error for admin forms. Pair with `useAdminFormValidation`. */
export function AdminFormField({
  label,
  htmlFor,
  field,
  error,
  required = false,
  className,
  children,
}: AdminFormFieldProps) {
  return (
    <label
      htmlFor={htmlFor}
      data-admin-field-label={field}
      className={cn(
        "grid gap-1.5",
        error && "rounded-md ring-2 ring-destructive/20",
        className,
      )}
    >
      <span className="text-sm font-medium text-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      {children}
      {error ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}
