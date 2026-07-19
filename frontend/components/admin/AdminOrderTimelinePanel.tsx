"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, XCircle, Clock } from "lucide-react";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { ensureArray, type AdminOrderTimeline } from "@/lib/admin-api";
import { formatAdminDate, orderStatusTone } from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";

interface AdminOrderTimelinePanelProps {
  orderId: string;
}

interface TimelineNodeStyle {
  circle: string;
  icon: typeof Check;
}

const NODE_STYLE: Record<string, TimelineNodeStyle> = {
  CONFIRMED: { circle: "bg-emerald-500/10 text-emerald-600", icon: Check },
  DELIVERED: { circle: "bg-emerald-500/10 text-emerald-600", icon: Check },
  SHIPPED: { circle: "bg-sky-500/10 text-sky-600", icon: Check },
  PROCESSING: { circle: "bg-sky-500/10 text-sky-600", icon: Check },
  OUT_FOR_DELIVERY: { circle: "bg-sky-500/10 text-sky-600", icon: Check },
  PICKED_UP: { circle: "bg-sky-500/10 text-sky-600", icon: Check },
  CANCELLED: { circle: "bg-red-500/10 text-red-600", icon: XCircle },
  REFUNDED: { circle: "bg-red-500/10 text-red-600", icon: CircleAlert },
  PAYMENT_FAILED: { circle: "bg-red-500/10 text-red-600", icon: XCircle },
  PENDING_PAYMENT: { circle: "bg-amber-500/10 text-amber-600", icon: Clock },
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
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="font-heading text-sm font-semibold">Status timeline</h2>
          {data ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Current: {data.currentStatus}
            </p>
          ) : null}
        </div>
        {data ? (
          <AdminStatusBadge
            label={data.currentStatus}
            tone={orderStatusTone(data.currentStatus)}
          />
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="mt-0.5 h-6 w-6 shrink-0 rounded-full" />
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No status transitions recorded.</p>
      ) : (
        <ol>
          {events.map((event, idx) => {
            const node = NODE_STYLE[event.toStatus] ?? {
              circle: "bg-muted text-muted-foreground",
              icon: Clock,
            };
            const Icon = node.icon;
            const isLast = idx === events.length - 1;
            return (
              <li key={event.id} className="relative flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${node.circle}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  {!isLast ? (
                    <span className="my-1 min-h-3 flex-1 border-l border-border" />
                  ) : null}
                </div>
                <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-4"}`}>
                  <p className="text-sm font-medium leading-tight text-foreground">
                    {event.toStatus.replace(/_/g, " ")}
                  </p>
                  {event.fromStatus ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      from {event.fromStatus.replace(/_/g, " ")}
                    </p>
                  ) : null}
                  {event.note ? (
                    <p className="mt-0.5 text-xs italic text-muted-foreground">{event.note}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatAdminDate(event.createdAt)}
                    {event.triggeredBy ? (
                      <span className="ml-1 font-mono uppercase">{event.triggeredBy}</span>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
