import { formatPaise, orderStatusDisplay } from "@/lib/admin-format";

/**
 * How one OrderStatusHistory row reads in the admin History panel.
 *
 * Most rows are status changes and read as the status they moved to. Refund
 * rows are events, not moves (from === to): they used to be labelled with the
 * order's status, so a refund noted on a courier-cancelled order showed up as
 * "Shipped" after "Cancelled". They now read as what happened to the money.
 */
export type HistoryEventKind =
  | "status"
  | "refund-started"
  | "refund-attempted"
  | "refund-failed"
  | "refund-owed"
  | "refund-retry"
  | "refund-done";

export interface HistoryEventView {
  kind: HistoryEventKind;
  label: string;
  note: string;
}

const REFUND_RULES: Array<{ test: RegExp; kind: HistoryEventKind; label: string }> = [
  { test: /^Refund sent to provider/, kind: "refund-started", label: "Refund started" },
  { test: /^Refund failed at provider/, kind: "refund-failed", label: "Refund failed" },
  { test: /^Refund failed/, kind: "refund-failed", label: "Refund failed" },
  { test: /^Refund still owed/, kind: "refund-owed", label: "Refund still owed" },
  { test: /^Refund retry requested/, kind: "refund-retry", label: "Refund retried" },
  { test: /^Partial refund processed/, kind: "refund-done", label: "Partial refund" },
  // Written by older backends once per ATTEMPT, before the provider answered —
  // so it does not prove the money moved.
  { test: /^Refund initiated/, kind: "refund-attempted", label: "Refund attempted" },
];

export function describeHistoryEvent(row: {
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
}): HistoryEventView {
  const note = cleanHistoryNote(row.note);
  const raw = (row.note ?? "").trim();
  const isEvent = row.fromStatus !== null && row.fromStatus === row.toStatus;
  if (isEvent) {
    const rule = REFUND_RULES.find((r) => r.test.test(raw));
    if (rule) return { kind: rule.kind, label: rule.label, note };
  }
  return { kind: "status", label: orderStatusDisplay(row.toStatus).label, note };
}

/**
 * Drop the internal `[admin:<uuid>]` audit tag and the trailing "by <actor>"
 * (the actor is shown on its own line), and show paise amounts as rupees.
 */
export function cleanHistoryNote(note: string | null | undefined): string {
  return (note ?? "")
    .replace(/\s*\[admin:[^\]]+\]\s*/g, " ")
    .replace(/\((\d+) paise\)/g, (_m, paise: string) => `(${formatPaise(Number(paise))})`)
    .replace(/\)\s+by\s+[a-z_]+$/i, ")")
    .trim();
}
