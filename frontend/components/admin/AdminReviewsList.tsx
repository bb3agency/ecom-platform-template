"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";
import {
  buildAdminQuery,
  coercePaginatedResponse,
  toIsoDateRange,
  type AdminReviewListItem,
  readPaginatedItems,
  type PaginatedResponse,
} from "@/lib/admin-api";
import { formatAdminDate } from "@/lib/admin-format";
import { resolveProductImageUrl } from "@/lib/media-url";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import { createIdempotencyKey } from "@/lib/idempotency";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { hasAdminPermission, ADMIN_PERMISSIONS } from "@/lib/permissions";
import Image from "next/image";
import Link from "next/link";
import { Search, Check, X, Trash2, Eye, Loader2, Star, ImageIcon, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";

const PAGE_SIZE = 20;

export function AdminReviewsList({
  from,
  to,
}: {
  from?: string;
  to?: string;
} = {}) {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canModerate = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.reviewsModerate);
  const [page, setPage] = useState(1);
  const [approvedFilter, setApprovedFilter] = useState<string>("");
  const [ratingFilter, setRatingFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] =
    useState<PaginatedResponse<AdminReviewListItem> | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rating =
        ratingFilter !== "" ? Number(ratingFilter) : undefined;
      const response = await api<PaginatedResponse<AdminReviewListItem>>(
        `/admin/reviews${buildAdminQuery({
          page,
          limit: PAGE_SIZE,
          approved:
            approvedFilter === "" ? undefined : approvedFilter === "true",
          ratingGte: rating,
          ratingLte: rating,
          search: search.trim() || undefined,
          from: from ? toIsoDateRange(from) : undefined,
          to: to ? toIsoDateRange(to, true) : undefined,
        })}`,
      );
      setData(coercePaginatedResponse(response));
    } catch (err) {
      setError(getApiErrorMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, page, approvedFilter, ratingFilter, search, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ["reviews"]);

  useEffect(() => {
    setPage(1);
  }, [approvedFilter, ratingFilter, search, from, to]);

  async function moderate(reviewId: string, approved: boolean) {
    setActionId(reviewId);
    try {
      await api(`/admin/reviews/${reviewId}/moderate`, {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ approved }),
      });
      await load();
      notifyAdminDataChanged(["reviews", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setActionId(null);
    }
  }

  async function remove(reviewId: string) {
    const ok = await confirm({
      title: "Delete Review?",
      description: "The review will be permanently deleted. This cannot be undone.",
      confirmLabel: "Delete Review",
    });
    if (!ok) return;
    setActionId(reviewId);
    try {
      await api(`/admin/reviews/${reviewId}`, { method: "DELETE" });
      await load();
      notifyAdminDataChanged(["reviews", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setActionId(null);
    }
  }

  const rawItems = readPaginatedItems(data);
  const items = rawItems;

  return (
    <>
      {confirmDialog}
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border/40 bg-card p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <div className="relative flex-1 min-w-0 sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
            placeholder="Search reviews by product or customer…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setSearch(searchInput.trim());
                setPage(1);
              }
            }}
          />
        </div>

        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 sm:min-w-32"
          value={ratingFilter}
          onChange={(e) => setRatingFilter(e.target.value)}
        >
          <option value="">All Ratings</option>
          <option value="5">5 Stars</option>
          <option value="4">4 Stars</option>
          <option value="3">3 Stars</option>
          <option value="2">2 Stars</option>
          <option value="1">1 Star</option>
        </select>

        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 sm:min-w-32"
          value={approvedFilter}
          onChange={(e) => setApprovedFilter(e.target.value)}
        >
          <option value="">All Status</option>
          <option value="true">Published</option>
          <option value="false">Pending</option>
        </select>

        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-md border border-border/50 bg-card px-3 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          onClick={() => {
            setSearch(searchInput.trim());
            setPage(1);
          }}
        >
          Search
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive font-medium">
          {error}
        </div>
      ) : data ? (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm min-w-0 overflow-hidden">
          <AdminTableScroll>
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-3 py-4 w-10">
                    <input
                      type="checkbox"
                      className="rounded border-border accent-primary focus:ring-ring"
                      checked={
                        items.length > 0 &&
                        items.every((r) => selectedIds[r.id])
                      }
                      onChange={(e) => {
                        const next: Record<string, boolean> = {};
                        items.forEach((r) => {
                          next[r.id] = e.target.checked;
                        });
                        setSelectedIds(next);
                      }}
                    />
                  </th>
                  <th className="px-3 py-4 font-medium w-1/3">Review</th>
                  <th className="px-3 py-4 font-medium">Product</th>
                  <th className="px-3 py-4 font-medium">Customer</th>
                  <th className="px-3 py-4 font-medium">Rating</th>
                  <th className="px-3 py-4 font-medium">Date</th>
                  <th className="px-3 py-4 font-medium">Status</th>
                  <th className="px-3 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-4">
                      <EmptyState
                        icon={MessageSquare}
                        headline="No reviews awaiting moderation"
                        description="Everything is up to date."
                        className="border-none"
                      />
                    </td>
                  </tr>
                ) : null}
                {items.map((review) => (
                  <tr key={review.id} className="group hover:bg-muted/40">
                    <td className="px-3 py-4">
                      <input
                        type="checkbox"
                        className="rounded border-border accent-primary focus:ring-ring"
                        checked={Boolean(selectedIds[review.id])}
                        onChange={(e) =>
                          setSelectedIds((prev) => ({
                            ...prev,
                            [review.id]: e.target.checked,
                          }))
                        }
                      />
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex gap-3">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                          {review.images && review.images.length > 0 ? (
                            <Image
                              src={resolveProductImageUrl(review.images[0])}
                              alt="Review image"
                              width={40}
                              height={40}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                              <ImageIcon className="h-5 w-5" strokeWidth={1.5} />
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <p className="font-semibold text-foreground text-sm line-clamp-1">
                            {review.body
                              ? review.body.split("\n")[0]
                              : "No Title"}
                          </p>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {review.body
                              ? review.body
                              : "No review text provided."}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      {review.productSlug ? (
                        <Link
                          href={`/products/${review.productSlug}`}
                          className="font-medium text-foreground text-sm hover:text-primary hover:underline"
                        >
                          {review.productName ?? review.productId.slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="font-medium text-foreground text-sm">
                          {review.productName ?? review.productId.slice(0, 8)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary uppercase">
                          {review.author.firstName?.charAt(0)}
                          {review.author.lastName?.charAt(0)}
                        </div>
                        <p className="font-medium text-foreground text-xs">
                          {review.author.firstName} {review.author.lastName}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div
                        className="flex items-center gap-0.5"
                        role="img"
                        aria-label={`Rated ${review.rating} out of 5 stars`}
                      >
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            aria-hidden
                            className={`h-3.5 w-3.5 ${
                              star <= review.rating
                                ? "fill-amber-500 text-amber-500"
                                : "text-muted-foreground/30"
                            }`}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground whitespace-pre-wrap leading-tight">
                      {formatAdminDate(review.createdAt).replace(", ", "\n")}
                    </td>
                    <td className="px-3 py-4">
                      <Badge variant={review.approved ? "success" : "warning"} dot>
                        {review.approved ? "Published" : "Pending"}
                      </Badge>
                    </td>
                    <td className="px-3 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={review.productSlug ? `/products/${review.productSlug}` : `/admin`}
                          className="flex h-10 w-10 sm:h-7 sm:w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          title="View product"
                          target="_blank"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Link>

                        {canModerate && (!review.approved ? (
                          <button
                            type="button"
                            className="flex h-10 w-10 sm:h-7 sm:w-7 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400 transition-colors disabled:opacity-50"
                            disabled={actionId === review.id}
                            onClick={() => void moderate(review.id, true)}
                            title="Approve"
                            aria-label="Approve review"
                          >
                            {actionId === review.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="flex h-10 w-10 sm:h-7 sm:w-7 items-center justify-center rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400 transition-colors disabled:opacity-50"
                            disabled={actionId === review.id}
                            onClick={() => void moderate(review.id, false)}
                            title="Unpublish"
                            aria-label="Unpublish review"
                          >
                            {actionId === review.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                          </button>
                        ))}

                        {canModerate && (
                          <button
                            type="button"
                            className="flex h-10 w-10 sm:h-7 sm:w-7 items-center justify-center rounded-md border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
                            title="Delete review"
                            aria-label="Delete review"
                            disabled={actionId === review.id}
                            onClick={() => void remove(review.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableScroll>
          <div className="mt-6 border-t border-border pt-4">
            <AdminPagination meta={data.meta} onPageChange={setPage} />
          </div>
        </div>
      ) : null}
    </>
  );
}
