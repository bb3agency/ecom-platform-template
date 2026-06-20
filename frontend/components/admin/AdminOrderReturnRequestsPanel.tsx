"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { formatAdminDate } from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import type { AdminReturnRequestListItem, FlatPaginatedResponse } from "@/lib/admin-api";

interface AdminOrderReturnRequestsPanelProps {
  orderId: string;
}

const STATUS_CLASS: Record<string, string> = {
  REQUESTED: "text-amber-600",
  APPROVED: "text-emerald-600",
  REJECTED: "text-destructive",
  PICKED_UP: "text-blue-600",
  REFUNDED: "text-emerald-600",
};

export function AdminOrderReturnRequestsPanel({ orderId }: AdminOrderReturnRequestsPanelProps) {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canRead = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.ordersRead);

  const [items, setItems] = useState<AdminReturnRequestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<FlatPaginatedResponse<AdminReturnRequestListItem>>(
          `/admin/return-requests?orderId=${encodeURIComponent(orderId)}&limit=20`,
        );
        if (!cancelled) setItems(Array.isArray(data.items) ? data.items : []);
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [api, orderId, canRead]);

  if (!canRead) return null;
  if (loading) {
    return (
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </section>
    );
  }
  if (error) return null;
  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <RotateCcw className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">
          Return requests
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
            {items.length}
          </span>
        </h2>
      </header>
      <ul className="divide-y divide-border">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{r.customerName}</p>
              <p className="truncate text-xs text-muted-foreground">{r.reason}</p>
              <p className="text-xs text-muted-foreground">{formatAdminDate(r.createdAt)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className={`text-xs font-medium ${STATUS_CLASS[r.status] ?? "text-muted-foreground"}`}>
                {r.status}
              </span>
              <Link
                href={`/admin/returns/${r.id}`}
                className="text-xs text-primary hover:underline"
              >
                Review →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
