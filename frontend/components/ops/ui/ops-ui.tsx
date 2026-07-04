import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/* ——— Page chrome ——— */

export interface OpsPageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function OpsPageHeader({ title, description, actions }: OpsPageHeaderProps) {
  return (
    <header className="flex min-w-0 flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:pb-6">
      <div className="min-w-0 grid gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground sm:text-2xl lg:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export interface OpsPageFrameProps extends OpsPageHeaderProps {
  children: ReactNode;
  className?: string;
}

export function OpsPageFrame({
  title,
  description,
  actions,
  children,
  className,
}: OpsPageFrameProps) {
  return (
    <div className={cn("grid min-w-0 gap-5 sm:gap-8", className)}>
      <OpsPageHeader title={title} description={description} actions={actions} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ——— Surfaces ——— */

export interface OpsCardProps {
  children: ReactNode;
  className?: string;
  padding?: "none" | "md" | "lg";
}

export function OpsCard({ children, className, padding = "lg" }: OpsCardProps) {
  const pad =
    padding === "none" ? "" : padding === "md" ? "p-4 sm:p-5" : "p-5 sm:p-6";
  return (
    <div
      className={cn(
        "rounded-xl border border-border/80 bg-card/80 shadow-sm backdrop-blur-sm",
        pad,
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface OpsCardHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function OpsCardHeader({ title, description, actions }: OpsCardHeaderProps) {
  return (
    <div className="mb-4 flex min-w-0 flex-col gap-3 sm:mb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 grid gap-1">
        <h2 className="font-heading text-base font-semibold text-foreground sm:text-lg">{title}</h2>
        {description ? (
          <p className="text-sm text-pretty text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">{actions}</div>
      ) : null}
    </div>
  );
}

/* ——— Status ——— */

export type OpsBadgeTone = "default" | "success" | "warning" | "danger" | "info" | "muted";

export interface OpsBadgeProps {
  children: ReactNode;
  tone?: OpsBadgeTone;
  className?: string;
}

const BADGE_TONES: Record<OpsBadgeTone, string> = {
  default: "bg-secondary text-secondary-foreground",
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  danger: "bg-destructive/15 text-destructive",
  info: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  muted: "bg-muted text-muted-foreground",
};

export function OpsBadge({ children, tone = "default", className }: OpsBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface OpsStatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: OpsBadgeTone;
}

export function OpsStatCard({ label, value, hint, tone = "default" }: OpsStatCardProps) {
  return (
    <OpsCard padding="md" className="flex min-w-0 flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-heading text-xl font-semibold break-words tabular-nums text-foreground sm:text-2xl">
        {value}
      </p>
      {hint ? (
        <OpsBadge
          tone={tone}
          className="max-w-full whitespace-normal break-words text-left leading-snug"
        >
          {hint}
        </OpsBadge>
      ) : null}
    </OpsCard>
  );
}

/* ——— Feedback ——— */

export interface OpsAlertProps {
  title?: string;
  children: ReactNode;
  tone?: "info" | "success" | "warning" | "error";
  className?: string;
}

const ALERT_TONES = {
  info: "border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function OpsAlert({ title, children, tone = "info", className }: OpsAlertProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-lg border px-4 py-3 text-sm", ALERT_TONES[tone], className)}
    >
      {title ? <p className="mb-1 font-medium">{title}</p> : null}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

export function OpsLoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 px-5 py-8">
      <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
      <span className="size-2 animate-pulse rounded-full bg-primary [animation-delay:150ms]" aria-hidden />
      <span className="size-2 animate-pulse rounded-full bg-primary [animation-delay:300ms]" aria-hidden />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export interface OpsEmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function OpsEmptyState({ title, description, action }: OpsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <p className="font-heading text-base font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}

/* ——— Table ——— */

export interface OpsTableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export interface OpsDataTableProps<T> {
  columns: OpsTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyTitle?: string;
  emptyDescription?: string;
  mobileCardTitle?: (row: T) => ReactNode;
  mobileCardDescription?: (row: T) => ReactNode;
}

export function OpsDataTable<T>({
  columns,
  rows,
  rowKey,
  emptyTitle = "No records",
  emptyDescription,
  mobileCardTitle,
  mobileCardDescription,
}: OpsDataTableProps<T>) {
  if (rows.length === 0) {
    return <OpsEmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/80">
      <div className="grid min-w-0 grid-cols-1 gap-3 p-3 md:hidden">
        {rows.map((row) => (
          <article
            key={rowKey(row)}
            className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-border/70 bg-card/60 p-3 shadow-sm"
          >
            {mobileCardTitle ? (
              <div className="grid min-w-0 grid-cols-1 gap-1">
                <h3 className="text-sm font-semibold leading-tight text-foreground">
                  {mobileCardTitle(row)}
                </h3>
                {mobileCardDescription ? (
                  <p className="text-xs text-muted-foreground">{mobileCardDescription(row)}</p>
                ) : null}
              </div>
            ) : null}
            <dl className="grid min-w-0 grid-cols-1 gap-2">
              {columns.map((col) => (
                <div key={col.key} className="grid min-w-0 grid-cols-1 gap-1">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {col.header}
                  </dt>
                  <dd className={cn("text-sm text-foreground", col.className)}>{col.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-[48rem] text-sm">
          <thead>
            <tr className="border-b border-border/80 bg-muted/40">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60 bg-card/50">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="transition-colors hover:bg-muted/30">
                {columns.map((col) => (
                  <td key={col.key} className={cn("px-4 py-3 align-middle", col.className)}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ——— Form controls ——— */

const INPUT_CLASS =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50";

export interface OpsFieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}

export function OpsField({ label, htmlFor, hint, error, children, className }: OpsFieldProps) {
  return (
    <label className={cn("grid gap-1.5 text-sm", className)} htmlFor={htmlFor}>
      <span className="font-medium text-foreground">{label}</span>
      {children}
      {hint && !error ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </label>
  );
}

export type OpsInputProps = InputHTMLAttributes<HTMLInputElement>;

export function OpsInput({ className, ...props }: OpsInputProps) {
  return <input className={cn(INPUT_CLASS, className)} {...props} />;
}

export type OpsSelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function OpsSelect({ className, children, ...props }: OpsSelectProps) {
  return (
    <select className={cn(INPUT_CLASS, className)} {...props}>
      {children}
    </select>
  );
}

export type OpsTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function OpsTextarea({ className, ...props }: OpsTextareaProps) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export interface OpsCodeBlockProps {
  children: string;
  className?: string;
}

export function OpsCodeBlock({ children, className }: OpsCodeBlockProps) {
  return (
    <pre
      className={cn(
        "max-h-[28rem] overflow-auto rounded-lg border border-border/80 bg-muted/30 p-4 font-mono text-xs leading-relaxed text-foreground",
        className,
      )}
    >
      {children}
    </pre>
  );
}
