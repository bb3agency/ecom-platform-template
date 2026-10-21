"use client";

/**
 * Console kit — layout and data primitives shared by the admin and ops consoles.
 *
 * Every console page is built from these so spacing, hierarchy and mobile
 * behaviour are decided once. Rules they encode (see docs/CONSOLE_DESIGN_SYSTEM.md):
 *  - one surface level: a Panel never sits inside another Panel;
 *  - hairline borders separate things, shadows are only for overlays;
 *  - status is a dot plus words, never colour alone;
 *  - nothing may widen the page past the viewport — every grid/flex child that can
 *    hold long text gets min-w-0, and tables become stacked rows below `md`.
 */

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Search, X, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// ─── Page ────────────────────────────────────────────────────────────────────

/** Page body: consistent max width and vertical rhythm between sections. */
export function ConsolePage({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-5 sm:gap-6", className)}
      {...props}
    />
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: React.ReactNode;
  /** One line of context under the title. */
  description?: React.ReactNode;
  /** Parent pages for detail screens. Omit on top-level pages — the nav already says where you are. */
  breadcrumbs?: Crumb[];
  /** Right-aligned on desktop; a full-width row under the title on phones. */
  actions?: React.ReactNode;
  /** Small inline metadata next to the title, e.g. a status. */
  meta?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, breadcrumbs, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={cn("flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={`${crumb.label}-${i}`}>
                {i > 0 ? <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden /> : null}
                {crumb.href ? (
                  <Link href={crumb.href} className="truncate transition-colors hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="truncate">{crumb.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="min-w-0 break-words font-heading text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {meta}
        </div>
        {description ? <p className="max-w-prose text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div>
      ) : null}
    </header>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

interface PanelProps extends Omit<React.ComponentProps<"section">, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  /** Body without padding — for tables and lists that run edge to edge. */
  flush?: boolean;
  bodyClassName?: string;
}

/** The one work surface. Header and footer are separated from the body by hairlines. */
export function Panel({
  title,
  description,
  actions,
  footer,
  flush,
  className,
  bodyClassName,
  children,
  ...props
}: PanelProps) {
  const hasHeader = title || description || actions;
  return (
    <section
      className={cn("grid min-w-0 grid-cols-1 content-start overflow-hidden rounded-xl border border-border bg-card", className)}
      {...props}
    >
      {hasHeader ? (
        <header className="flex min-h-13 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold text-foreground">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("min-w-0", flush ? "" : "p-4 sm:p-5", bodyClassName)}>{children}</div>
      {footer ? (
        <footer className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 sm:px-5">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface StatItem {
  label: string;
  value: React.ReactNode;
  /** Percent change vs the comparison period. */
  deltaPct?: number | null;
  /** e.g. "vs previous 7 days". */
  deltaCaption?: string;
  hint?: React.ReactNode;
  href?: string;
}

/**
 * KPI band: one bordered strip divided by hairlines (not a row of floating cards).
 * Values never truncate — they wrap to a smaller size instead.
 */
export function StatStrip({ items, loading, className }: { items: StatItem[]; loading?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border",
        items.length >= 4 ? "lg:grid-cols-4" : items.length === 3 ? "lg:grid-cols-3" : "",
        className,
      )}
    >
      {items.map((item) => {
        const body = (
          <>
            <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
            {loading ? (
              <span className="mt-2 block h-7 w-20 animate-pulse rounded-md bg-muted" />
            ) : (
              <p className="mt-1 break-words font-heading text-xl font-semibold tracking-tight text-foreground tabular sm:text-2xl">
                {item.value}
              </p>
            )}
            {!loading && (item.deltaPct != null || item.hint) ? (
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                {item.deltaPct != null ? <Delta value={item.deltaPct} /> : null}
                {item.deltaPct != null && item.deltaCaption ? <span>{item.deltaCaption}</span> : null}
                {item.hint ? <span>{item.hint}</span> : null}
              </p>
            ) : null}
          </>
        );
        return item.href ? (
          <Link
            key={item.label}
            href={item.href}
            className="min-w-0 bg-card p-4 transition-colors hover:bg-muted/60 sm:p-5"
          >
            {body}
          </Link>
        ) : (
          <div key={item.label} className="min-w-0 bg-card p-4 sm:p-5">
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function Delta({ value }: { value: number }) {
  const flat = Math.abs(value) < 0.05;
  const direction = flat ? "flat" : value > 0 ? "up" : "down";
  const shown = Math.abs(value) >= 1000 ? ">999" : (Math.round(Math.abs(value) * 10) / 10).toString();
  return (
    <span className="console-delta font-medium tabular" data-direction={direction}>
      {flat ? "±0%" : `${value > 0 ? "+" : "−"}${shown}%`}
    </span>
  );
}

/** Percent change helper for StatStrip. Null when there is no baseline to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

export function StatusDot({
  tone = "neutral",
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { tone?: StatusTone }) {
  return (
    <span className={cn("console-status text-sm text-foreground", className)} data-tone={tone} {...props}>
      {children}
    </span>
  );
}

/** "PENDING_PAYMENT" → "Pending payment". For enum values shown to people. */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return "—";
  const words = value.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ─── Notice ──────────────────────────────────────────────────────────────────

export function Notice({
  tone = "info",
  title,
  icon: Icon,
  action,
  className,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: React.ReactNode;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      data-tone={tone}
      className={cn("console-notice flex min-w-0 flex-wrap items-start gap-3 rounded-lg px-4 py-3 text-sm", className)}
    >
      {Icon ? <Icon className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn("text-muted-foreground", title ? "mt-0.5" : "")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ─── Key/value ───────────────────────────────────────────────────────────────

/** Label/value pairs for detail screens. Two columns from `sm`, stacked on phones. */
export function KeyValueList({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode; wide?: boolean }[];
  className?: string;
}) {
  return (
    <dl className={cn("grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2", className)}>
      {items.map((item) => (
        <div key={item.label} className={cn("min-w-0", item.wide ? "sm:col-span-2" : "")}>
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-foreground">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Filters ─────────────────────────────────────────────────────────────────

interface FilterBarProps {
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: string;
  };
  /** Filter controls. Wrap on desktop, scroll sideways on phones (never push the page wider). */
  children?: React.ReactNode;
  /** Right side: sort, view toggles, "Clear". */
  trailing?: React.ReactNode;
  className?: string;
}

export function FilterBar({ search, children, trailing, className }: FilterBarProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center">
        {search ? <SearchInput {...search} className="md:max-w-xs" /> : null}
        {children ? (
          <div className="-mx-4 flex min-w-0 items-center gap-2 overflow-x-auto px-4 pb-0.5 scrollbar-hide md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
            {children}
          </div>
        ) : null}
      </div>
      {trailing ? <div className="flex min-w-0 shrink-0 items-center gap-2">{trailing}</div> : null}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full min-w-0", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        data-slot="input"
        className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** Native select styled to match. Native on purpose: best mobile picker, zero JS. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-slot="select-trigger"
      className={cn(
        "console-select h-9 shrink-0 cursor-pointer appearance-none rounded-lg border border-input bg-card pl-3 pr-8 text-sm text-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── Data table ──────────────────────────────────────────────────────────────

export interface DataColumn<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right";
  /** Hide in the desktop table below this breakpoint (the mobile card still shows it). */
  hideBelow?: "lg" | "xl";
  className?: string;
  /** Label used on the phone card. Defaults to `header` when it is a string. */
  mobileLabel?: string;
  /** Leave this column out of the phone card (e.g. a checkbox or a value shown in the card title). */
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string;
  /** Whole row links here (table row and phone card). */
  rowHref?: (row: T) => string | undefined;
  /** Phone card title line — usually the record name/number and its status. */
  mobileTitle?: (row: T) => React.ReactNode;
  /** Replace the generated phone card entirely. */
  mobileCard?: (row: T) => React.ReactNode;
  loading?: boolean;
  /** Shown when there are no rows and not loading. */
  empty?: React.ReactNode;
  caption?: string;
  className?: string;
  /** Selected-row highlight. */
  isSelected?: (row: T) => boolean;
}

const HIDE_BELOW: Record<NonNullable<DataColumn<unknown>["hideBelow"]>, string> = {
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

/**
 * Table from `md` up; stacked cards below. Horizontal scrolling is the last resort
 * (only for genuinely wide desktop tables), never the phone layout.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  rowHref,
  mobileTitle,
  mobileCard,
  loading,
  empty,
  caption,
  className,
  isSelected,
}: DataTableProps<T>) {
  if (loading && rows.length === 0) {
    return <TableSkeleton columns={Math.min(columns.length, 6)} />;
  }
  if (!loading && rows.length === 0) {
    return <div className="p-4 sm:p-5">{empty ?? <p className="text-sm text-muted-foreground">Nothing here yet.</p>}</div>;
  }

  return (
    <div className={cn("min-w-0", loading ? "opacity-60 transition-opacity" : "", className)} aria-busy={loading || undefined}>
      {/* Desktop / tablet */}
      <div className="hidden min-w-0 overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    "h-10 whitespace-nowrap px-4 text-xs font-medium text-muted-foreground first:pl-5 last:pr-5",
                    col.align === "right" ? "text-right" : "text-left",
                    col.hideBelow ? HIDE_BELOW[col.hideBelow] : "",
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  className={cn(
                    "group border-b border-border last:border-b-0 transition-colors",
                    href ? "cursor-pointer hover:bg-muted/50" : "",
                    isSelected?.(row) ? "bg-primary/5" : "",
                  )}
                >
                  {columns.map((col, i) => (
                    <td
                      key={col.key}
                      className={cn(
                        "relative px-4 py-3 align-middle first:pl-5 last:pr-5",
                        col.align === "right" ? "text-right" : "text-left",
                        col.hideBelow ? HIDE_BELOW[col.hideBelow] : "",
                        col.className,
                      )}
                    >
                      {/* The first cell carries the row link so the whole row is one target
                          without nesting interactive elements inside an anchor. */}
                      {href && i === 0 ? (
                        <Link href={href} className="absolute inset-0" aria-label="Open" tabIndex={-1} />
                      ) : null}
                      <div className={cn("relative", href ? "pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_label]:pointer-events-auto" : "")}>
                        {col.cell(row)}
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phone */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((row) => {
          if (mobileCard) return <li key={rowKey(row)} className="min-w-0">{mobileCard(row)}</li>;
          const href = rowHref?.(row);
          const details = columns.filter((c) => !c.hideOnMobile);
          const content = (
            <div className="flex min-w-0 flex-col gap-2 px-4 py-3">
              {mobileTitle ? <div className="min-w-0">{mobileTitle(row)}</div> : null}
              <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2">
                {details.map((col) => (
                  <div key={col.key} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      {col.mobileLabel ?? (typeof col.header === "string" ? col.header : col.key)}
                    </dt>
                    <dd className="mt-0.5 min-w-0 break-words text-sm text-foreground">{col.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
          return (
            <li key={rowKey(row)} className={cn("relative min-w-0", isSelected?.(row) ? "bg-primary/5" : "")}>
              {href ? (
                <>
                  <Link href={href} className="absolute inset-0" aria-label="Open" />
                  <div className="pointer-events-none relative [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_label]:pointer-events-auto">
                    {content}
                  </div>
                </>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TableSkeleton({ columns = 5, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div className="min-w-0 divide-y divide-border" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
          {Array.from({ length: columns }).map((__, c) => (
            <span
              key={c}
              className={cn("h-3.5 animate-pulse rounded bg-muted", c === 0 ? "w-28" : "hidden flex-1 md:block")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Forms ───────────────────────────────────────────────────────────────────

/**
 * Form section: heading + help on the left, fields on the right from `lg`;
 * stacked on smaller screens. Used inside a Panel or directly on the page.
 */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-8", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">{children}</div>
    </div>
  );
}

/**
 * Save/cancel bar. Sticks just above the bottom tab bar on phones/tablets
 * so the primary action is always in thumb reach on long forms; inline on desktop.
 */
export function StickyActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        // Phones/tablets: stick just above the 56px bottom tab bar. Desktop: inline.
        "sticky bottom-14 z-20 -mx-4 flex min-w-0 items-center justify-end gap-2 border-t border-border bg-card px-4 py-3 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─── Misc ────────────────────────────────────────────────────────────────────

/** Initial-letter avatar for people and brands without an image. */
export function Monogram({ name, className }: { name: string | null | undefined; className?: string }) {
  const letter = (name ?? "").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground",
        className,
      )}
    >
      {letter}
    </span>
  );
}
