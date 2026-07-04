"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { ensureArray, type AdminOrderTimeline } from "@/lib/admin-api";
import { formatAdminDate, orderStatusTone } from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";

interface AdminOrderTimelinePanelProps {
  orderId: string;
}

const STATUS_DOT: Record<string, string> = {
  CONFIRMED: "bg-emerald-500",
  DELIVERED: "bg-emerald-500",
  SHIPPED: "bg-blue-500",
  PROCESSING: "bg-blue-500",
  OUT_FOR_DELIVERY: "bg-blue-500",
  PICKED_UP: "bg-blue-500",
  CANCELLED: "bg-red-500",
  REFUNDED: "bg-red-400",
  PAYMENT_FAILED: "bg-red-500",
  PENDING_PAYMENT: "bg-amber-500",
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
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="mt-1 h-3 w-3 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="grid min-w-0 grid-cols-1 gap-1.5 flex-1">
                <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
                <div className="h-3 w-32 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No status transitions recorded.</p>
      ) : (
        <ol className="relative ml-1.5 border-l border-border">
          {events.map((event, idx) => {
            const dotColor = STATUS_DOT[event.toStatus] ?? "bg-muted-foreground/40";
            const isLast = idx === events.length - 1;
            return (
              <li key={event.id} className={`relative pb-4 pl-5 ${isLast ? "pb-0" : ""}`}>
                <span
                  className={`absolute -left-[7px] top-[3px] h-3.5 w-3.5 rounded-full border-2 border-card ${dotColor}`}
                />
                <p className="text-sm font-medium leading-tight">{event.toStatus}</p>
                {event.fromStatus ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    from {event.fromStatus}
                  </p>
                ) : null}
                {event.note ? (
                  <p className="mt-0.5 text-xs italic text-muted-foreground">{event.note}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {formatAdminDate(event.createdAt)}
                  {event.triggeredBy ? (
                    <span className="ml-1 font-mono uppercase">{event.triggeredBy}</span>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
