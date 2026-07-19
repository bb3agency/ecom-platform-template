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
import { Search, Check, X, Trash2, Eye, Loader2 } from "lucide-react";
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
            className="h-9 w-full rounded-md border border-border/50 bg-muted/20 pl-9 pr-3 text-sm focus:border-zinc-900 focus:outline-none"
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
          className="h-9 rounded-md border border-border/50 bg-muted/20 px-3 text-sm font-medium text-foreground focus:border-zinc-900 focus:outline-none sm:min-w-32"
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
          className="h-9 rounded-md border border-border/50 bg-muted/20 px-3 text-sm font-medium text-foreground focus:border-zinc-900 focus:outline-none sm:min-w-32"
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
        <div className="flex h-48 w-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive font-medium">
          {error}
        </div>
      ) : data ? (
        <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm min-w-0 overflow-hidden">
          <AdminTableScroll>
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border/40 text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-3 py-4 w-10">
                    <input
                      type="checkbox"
                      className="rounded border-border text-zinc-900 focus:ring-zinc-900"
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
              <tbody className="divide-y divide-border/20">
                {items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No reviews found.
                    </td>
                  </tr>
                ) : null}
                {items.map((review) => (
                  <tr key={review.id} className="group hover:bg-muted/20">
                    <td className="px-3 py-4">
                      <input
                        type="checkbox"
                        className="rounded border-border text-zinc-900 focus:ring-zinc-900"
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
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border/50 bg-muted">
                          {review.images && review.images.length > 0 ? (
                            <Image
                              src={resolveProductImageUrl(review.images[0])}
                              alt="Review image"
                              width={40}
                              height={40}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-zinc-100 text-zinc-900">
                              <svg
                                className="h-5 w-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={1.5}
                                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <p className="font-semibold text-foreground text-sm line-clamp-1">
                            {review.body
                              ? review.body.split("\n")[0]
                              : "No Title"}
                          </p>
                          <p className="text-[11px] text-muted-foreground line-clamp-1">
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
                          className="font-medium text-foreground text-sm hover:text-zinc-900 hover:underline"
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
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[9px] font-bold text-blue-700 uppercase">
                          {review.author.firstName?.charAt(0)}
                          {review.author.lastName?.charAt(0)}
                        </div>
                        <p className="font-medium text-foreground text-xs">
                          {review.author.firstName} {review.author.lastName}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-0.5 text-amber-400">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <svg
                            key={star}
                            className={`h-3.5 w-3.5 ${star <= review.rating ? "fill-current text-amber-400" : "fill-none text-muted-foreground/30 stroke-current"}`}
                            viewBox="0 0 24 24"
                            strokeWidth={star <= review.rating ? 0 : 2}
                          >
                            <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground whitespace-pre-wrap leading-tight">
                      {formatAdminDate(review.createdAt).replace(", ", "\n")}
                    </td>
                    <td className="px-3 py-4">
                      <div
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                          review.approved
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-amber-50 text-amber-600 border-amber-100"
                        }`}
                      >
                        {review.approved ? "Published" : "Pending"}
                      </div>
                    </td>
                    <td className="px-3 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={review.productSlug ? `/products/${review.productSlug}` : `/admin`}
                          className="flex h-7 w-7 items-center justify-center rounded border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          title="View product"
                          target="_blank"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Link>

                        {canModerate && (!review.approved ? (
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
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
                            className="flex h-7 w-7 items-center justify-center rounded border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors"
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
                            className="flex h-7 w-7 items-center justify-center rounded border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
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
          <div className="mt-6 border-t border-border/40 pt-4">
            <AdminPagination meta={data.meta} onPageChange={setPage} />
          </div>
        </div>
      ) : null}
    </>
  );
}
