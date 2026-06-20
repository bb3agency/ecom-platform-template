"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminReviewsList } from "@/components/admin/AdminReviewsList";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import {
  Star,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Shield,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import {
  buildAdminQuery,
  coercePaginatedResponse,
  toIsoDateRange,
  type AdminReviewSummary,
  type PaginatedResponse,
} from "@/lib/admin-api";
import {
  defaultDateRange,
  trendPeriodLabel,
  prevRange,
  rangeToISO,
  type DateRange,
} from "@/components/admin/AdminDateRangePicker";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

// ── shared helpers ──────────────────────────────────────────────────────────

function calcTrend(
  cur: number,
  prev: number,
): { value: string; up: boolean } | null {
  if (!prev) return null;
  const pct = ((cur - prev) / prev) * 100;
  const abs = Math.round(Math.abs(pct) * 10) / 10;
  return { value: `${pct >= 0 ? "+" : "-"}${abs}%`, up: pct >= 0 };
}

// ── KpiCard ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  iconBg,
  trend,
  trendUp,
  trendLabel,
  description,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconBg: string;
  trend?: string;
  trendUp?: boolean;
  trendLabel?: string;
  description?: string;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
      <div className="flex items-center gap-3 sm:gap-4">
        <div
          className={`flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl ${iconBg}`}
        >
          {icon}
        </div>
        <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
          <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">{label}</p>
          {loading ? (
            <div className="h-6 sm:h-7 w-16 sm:w-24 animate-pulse rounded bg-muted" />
          ) : (
            <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
              {value}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[11px] font-medium">
        {loading ? (
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        ) : trend !== undefined && trendUp !== undefined ? (
          <>
            {trendUp ? (
              <TrendingUp className="h-3 w-3 text-emerald-500" />
            ) : (
              <TrendingDown className="h-3 w-3 text-rose-500" />
            )}
            <span className={trendUp ? "text-emerald-600" : "text-rose-600"}>
              {trend}
            </span>
            <span className="text-muted-foreground">
              {trendLabel ?? "vs prev period"}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">{description}</span>
        )}
      </div>
    </div>
  );
}

// ── AdminReviewsKpis ─────────────────────────────────────────────────────────

interface ReviewKpis {
  total: number;
  published: number;
  lowRatings: number;
  pending: number;
  averageRating: number | null;
  totalPrev: number;
  publishedPrev: number;
  lowRatingsPrev: number;
  pendingPrev: number;
}

interface AdminReviewsKpisProps {
  from: string;
  to: string;
  trendLabel: string;
}

function AdminReviewsKpis({ from, to, trendLabel }: AdminReviewsKpisProps) {
  const api = useAuthenticatedApi();
  const [kpis, setKpis] = useState<ReviewKpis | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { fromISO, toISO } = rangeToISO(from, to);
      const prev = prevRange(from, to);
      const cur = (extra: Record<string, string | number | boolean | undefined>) =>
        `/admin/reviews${buildAdminQuery({
          limit: 1,
          from: fromISO,
          to: toISO,
          ...extra,
        })}`;
      const prv = (extra: Record<string, string | number | boolean | undefined>) =>
        `/admin/reviews${buildAdminQuery({
          limit: 1,
          from: prev.from,
          to: prev.to,
          ...extra,
        })}`;

      const [
        totalRes,
        publishedRes,
        lowRatingsRes,
        pendingRes,
        summaryRes,
        totalPrevRes,
        publishedPrevRes,
        lowRatingsPrevRes,
        pendingPrevRes,
      ] = await Promise.all([
        api<PaginatedResponse<unknown>>(cur({})),
        api<PaginatedResponse<unknown>>(cur({ approved: true })),
        api<PaginatedResponse<unknown>>(cur({ approved: true, ratingLte: 2 })),
        api<PaginatedResponse<unknown>>(cur({ approved: false })),
        api<AdminReviewSummary>(
          `/admin/reviews/summary${buildAdminQuery({
            from: fromISO,
            to: toISO,
          })}`,
        ),
        api<PaginatedResponse<unknown>>(prv({})),
        api<PaginatedResponse<unknown>>(prv({ approved: true })),
        api<PaginatedResponse<unknown>>(prv({ approved: true, ratingLte: 2 })),
        api<PaginatedResponse<unknown>>(prv({ approved: false })),
      ]);

      const g = (r: PaginatedResponse<unknown>) =>
        coercePaginatedResponse(r).meta.total;

      setKpis({
        total: g(totalRes),
        published: g(publishedRes),
        lowRatings: g(lowRatingsRes),
        pending: g(pendingRes),
        averageRating: summaryRes.averageRating,
        totalPrev: g(totalPrevRes),
        publishedPrev: g(publishedPrevRes),
        lowRatingsPrev: g(lowRatingsPrevRes),
        pendingPrev: g(pendingPrevRes),
      });
    } catch {
      // silently keep kpis null — cards will show "—"
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ["reviews", "dashboard"]);

  const totalTrend = kpis ? calcTrend(kpis.total, kpis.totalPrev) : null;
  const publishedTrend = kpis
    ? calcTrend(kpis.published, kpis.publishedPrev)
    : null;
  const lowRatingsTrend = kpis
    ? calcTrend(kpis.lowRatings, kpis.lowRatingsPrev)
    : null;
  const pendingTrend = kpis ? calcTrend(kpis.pending, kpis.pendingPrev) : null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
      <KpiCard
        label="Total Reviews"
        value={kpis ? kpis.total.toLocaleString() : "—"}
        icon={<Star className="h-5 w-5 text-emerald-600" />}
        iconBg="bg-emerald-100"
        trend={totalTrend?.value}
        trendUp={totalTrend?.up}
        trendLabel={trendLabel}
        loading={loading}
      />
      <KpiCard
        label="Average Rating"
        value={
          kpis?.averageRating != null
            ? kpis.averageRating.toFixed(1)
            : "—"
        }
        icon={<MessageSquare className="h-5 w-5 text-blue-600" />}
        iconBg="bg-blue-100"
        description="Approved reviews in range"
        loading={loading}
      />
      <KpiCard
        label="Positive Reviews"
        value={kpis ? kpis.published.toLocaleString() : "—"}
        icon={<ThumbsUp className="h-5 w-5 text-purple-600" />}
        iconBg="bg-purple-100"
        trend={publishedTrend?.value}
        trendUp={publishedTrend?.up}
        trendLabel={trendLabel}
        loading={loading}
      />
      <KpiCard
        label="Low ratings (≤2★)"
        value={kpis ? kpis.lowRatings.toLocaleString() : "—"}
        icon={<ThumbsDown className="h-5 w-5 text-rose-600" />}
        iconBg="bg-rose-100"
        trend={lowRatingsTrend?.value}
        trendUp={lowRatingsTrend?.up}
        trendLabel={trendLabel}
        loading={loading}
      />
      <KpiCard
        label="Pending Reviews"
        value={kpis ? kpis.pending.toLocaleString() : "—"}
        icon={<Shield className="h-5 w-5 text-amber-600" />}
        iconBg="bg-amber-100"
        trend={pendingTrend?.value}
        trendUp={pendingTrend?.up}
        trendLabel={trendLabel}
        loading={loading}
      />
    </div>
  );
}

function AdminReviewsRatingOverview({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const api = useAuthenticatedApi();
  const [summary, setSummary] = useState<AdminReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api<AdminReviewSummary>(
        `/admin/reviews/summary${buildAdminQuery({
          from: toIsoDateRange(from),
          to: toIsoDateRange(to, true),
        })}`,
      );
      setSummary(response);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ["reviews", "dashboard"]);

  const total = summary?.totalApproved ?? 0;
  const distribution = summary?.distribution ?? {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
  };

  return (
    <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm">
      <h3 className="font-heading text-base font-bold text-foreground mb-4">
        Rating Overview
      </h3>
      {loading ? (
        <div className="h-40 animate-pulse rounded bg-muted" />
      ) : (
        <>
          <div className="flex items-baseline gap-3 mb-1">
            <span className="text-4xl font-bold">
              {summary?.averageRating != null
                ? summary.averageRating.toFixed(1)
                : "—"}
            </span>
            <div className="flex text-amber-400">
              {Array.from({ length: 5 }).map((_, index) => (
                <Star
                  key={index}
                  className={`h-5 w-5 ${
                    summary?.averageRating != null &&
                    index < Math.round(summary.averageRating)
                      ? "fill-current"
                      : ""
                  }`}
                />
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground font-medium mb-6">
            Based on {total.toLocaleString()} approved reviews
          </p>

          <div className="flex flex-col gap-3">
            {([5, 4, 3, 2, 1] as const).map((stars) => {
              const count = distribution[String(stars) as keyof typeof distribution];
              const percent = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div
                  key={stars}
                  className="flex items-center gap-3 text-xs font-medium text-muted-foreground"
                >
                  <span className="w-12">{stars} Stars</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="w-8 text-right">{count}</span>
                  <span className="w-10 text-right">({percent}%)</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminReviewsPage() {
  const [range, setRange] = useState<DateRange>(defaultDateRange);
  const trendLabel = trendPeriodLabel(range.from, range.to);

  return (
    <div className="flex flex-col gap-6 min-w-0">
      <AdminPageHeader
        title="Reviews"
        range={range}
        onRangeChange={setRange}
      />

      <AdminReviewsKpis
        from={range.from}
        to={range.to}
        trendLabel={trendLabel}
      />

      <div className="flex flex-col gap-6 lg:flex-row min-w-0">
        <div className="flex-1 min-w-0 overflow-hidden">
          <AdminReviewsList from={range.from} to={range.to} />
        </div>

        <div className="flex w-full flex-col gap-6 lg:w-[320px] shrink-0">
          <AdminReviewsRatingOverview from={range.from} to={range.to} />
        </div>
      </div>
    </div>
  );
}
