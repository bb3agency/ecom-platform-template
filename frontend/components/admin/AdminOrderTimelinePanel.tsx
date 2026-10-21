"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote, Check, CircleAlert, XCircle, Clock } from "lucide-react";
import { Panel } from "@/components/ui/console";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { ensureArray, type AdminOrderTimeline } from "@/lib/admin-api";
import { formatAdminDateCompact, sentenceCaseEnum } from "@/lib/admin-format";
import { describeHistoryEvent, type HistoryEventKind } from "@/lib/order-history-event";
import { getApiErrorMessage } from "@/lib/error-messages";

interface AdminOrderTimelinePanelProps {
  orderId: string;
}

interface TimelineNodeStyle {
  circle: string;
  icon: typeof Check;
}

const NODE_STYLE: Record<string, TimelineNodeStyle> = {
  CONFIRMED: { circle: "bg-success/10 text-success", icon: Check },
  DELIVERED: { circle: "bg-success/10 text-success", icon: Check },
  SHIPPED: { circle: "bg-info-soft text-info", icon: Check },
  PROCESSING: { circle: "bg-info-soft text-info", icon: Check },
  OUT_FOR_DELIVERY: { circle: "bg-info-soft text-info", icon: Check },
  PICKED_UP: { circle: "bg-info-soft text-info", icon: Check },
  CANCELLED: { circle: "bg-destructive/10 text-destructive", icon: XCircle },
  REFUNDED: { circle: "bg-destructive/10 text-destructive", icon: CircleAlert },
  PAYMENT_FAILED: { circle: "bg-destructive/10 text-destructive", icon: XCircle },
  PENDING_PAYMENT: { circle: "bg-warning-soft text-warning", icon: Clock },
};

const REFUND_NODE_STYLE: Record<Exclude<HistoryEventKind, "status">, TimelineNodeStyle> = {
  "refund-started": { circle: "bg-info-soft text-info", icon: Banknote },
  "refund-attempted": { circle: "bg-muted text-muted-foreground", icon: Banknote },
  "refund-retry": { circle: "bg-info-soft text-info", icon: Banknote },
  "refund-done": { circle: "bg-success/10 text-success", icon: Banknote },
  "refund-failed": { circle: "bg-destructive/10 text-destructive", icon: CircleAlert },
  "refund-owed": { circle: "bg-destructive/10 text-destructive", icon: CircleAlert },
};

export function AdminOrderTimelinePanel({ orderId }: AdminOrderTimelinePanelProps) {
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminOrderTimeline | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const timeline = await api<AdminOrderTimeline>(`/admin/orders/${orderId}/timeline`);
      setData(timeline);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const events = ensureArray<AdminOrderTimeline["timeline"][number]>(data?.timeline);

  return (
    <Panel title="History">
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="mt-0.5 size-6 shrink-0 rounded-full" />
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No status changes yet.</p>
      ) : (
        <ol>
          {events.map((event, idx) => {
            const view = describeHistoryEvent(event);
            const node = (view.kind === "status" ? NODE_STYLE[event.toStatus] : REFUND_NODE_STYLE[view.kind]) ?? {
              circle: "bg-muted text-muted-foreground",
              icon: Clock,
            };
            const Icon = node.icon;
            const isLast = idx === events.length - 1;
            const note = view.note;
            return (
              <li key={event.id} className="relative flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${node.circle}`}>
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  {!isLast ? <span className="my-1 min-h-3 flex-1 border-l border-border" /> : null}
                </div>
                <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-4"}`}>
                  <p className="text-sm font-medium leading-tight text-foreground">
                    {view.label}
                  </p>
                  {note ? <p className="mt-0.5 break-words text-sm text-muted-foreground">{note}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatAdminDateCompact(event.createdAt)}
                    {event.triggeredBy ? ` · ${sentenceCaseEnum(event.triggeredBy)}` : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
