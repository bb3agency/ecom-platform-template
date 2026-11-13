"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminSection } from "@/components/admin/AdminSection";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { createIdempotencyKey } from "@/lib/idempotency";
import { createMutationGate } from "@/lib/mutation-gate";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import {
  ensureArray,
  getPaginatedItems,
  type AdminCustomerAddress,
  type AdminCustomerOrderSummary,
  type AdminCustomerProfile,
  type AdminUserNote,
  type PaginatedResponse,
} from "@/lib/admin-api";
import { formatAdminDate, formatPaise, orderStatusTone } from "@/lib/admin-format";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { hasAdminPermission, ADMIN_PERMISSIONS } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth";
import { AdminLoadingBlock } from "@/components/admin/ui/admin-ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { MapPin, ShoppingBag, StickyNote, UserXIcon } from "lucide-react";

interface AdminCustomerDetailPanelProps {
  customerId: string;
}

export function AdminCustomerDetailPanel({ customerId }: AdminCustomerDetailPanelProps) {
  const api = useAuthenticatedApi();
  const user = useAuthStore((s) => s.user);
  const [profile, setProfile] = useState<AdminCustomerProfile | null>(null);
  const [orders, setOrders] = useState<AdminCustomerOrderSummary[]>([]);
  const [notes, setNotes] = useState<AdminUserNote[]>([]);
  const [noteText, setNoteText] = useState("");
  const { confirm, confirmDialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Which mutation is in flight ("note" | "ban" | "unban" | "note:<id>"), for button states.
  const [busy, setBusy] = useState<string | null>(null);
  const [gate] = useState(() => createMutationGate(setBusy));

  const canWrite = hasAdminPermission(user, ADMIN_PERMISSIONS.usersWrite);

  /** `silent` refreshes in place (after a mutation) without swapping the panel for a skeleton. */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [nextProfile, nextOrders, nextNotes] = await Promise.all([
        api<AdminCustomerProfile>(`/admin/users/${customerId}`),
        api<PaginatedResponse<AdminCustomerOrderSummary>>(
          `/admin/users/${customerId}/orders?page=1&limit=20`,
        ),
        api<AdminUserNote[]>(`/admin/users/${customerId}/notes`),
      ]);
      setProfile({
        ...nextProfile,
        addresses: ensureArray<AdminCustomerAddress>(nextProfile.addresses),
      });
      setOrders(getPaginatedItems(nextOrders));
      setNotes(ensureArray<AdminUserNote>(nextNotes));
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setLoading(false);
    }
  }, [api, customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** One mutation at a time; clears stale feedback first, refreshes in place on success. */
  async function mutate(key: string, request: () => Promise<unknown>, successMessage: string) {
    setError(null);
    setMessage(null);
    const result = await gate.run(key, request);
    if (result.ok) {
      setMessage(successMessage);
      notifyAdminDataChanged(["customers", "dashboard"]);
      await load(true);
    } else if (result.reason === "error") {
      setError(getApiErrorMessageWithHint(result.error));
    }
    return result.ok;
  }

  if (loading) {
    return <AdminLoadingBlock label="Loading customer…" />;
  }

  if (error && !profile) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!profile) {
    return <p className="text-sm text-muted-foreground">Customer not found.</p>;
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      {confirmDialog}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}

      {/* Customer header */}
      <div className="flex min-w-0 flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold uppercase text-primary">
          {profile.firstName?.[0]}
          {profile.lastName?.[0]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-heading text-lg font-semibold text-foreground">
              {profile.firstName} {profile.lastName}
            </h2>
            <Badge dot variant={profile.isBanned ? "destructive" : "success"}>
              {profile.isBanned ? "Banned" : "Active"}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Customer since {formatAdminDate(profile.createdAt)}
          </p>
        </div>
      </div>

      <AdminSection title="Profile">
        <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Name</dt>
            <dd className="text-sm text-foreground">
              {profile.firstName} {profile.lastName}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="break-words text-sm text-foreground">{profile.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Phone</dt>
            <dd className="text-sm text-foreground">{profile.phone ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Joined</dt>
            <dd className="text-sm text-foreground">{formatAdminDate(profile.createdAt)}</dd>
          </div>
          {profile.isBanned ? (
            <div className="space-y-1 sm:col-span-2">
              <Badge dot variant="destructive">
                Banned
              </Badge>
              {profile.bannedAt ? (
                <p className="text-xs text-muted-foreground">
                  Since {formatAdminDate(profile.bannedAt)}
                </p>
              ) : null}
              {profile.bannedReason ? (
                <p className="text-xs text-muted-foreground">{profile.bannedReason}</p>
              ) : null}
            </div>
          ) : null}
        </dl>
      </AdminSection>

      <AdminSection title="Addresses">
        {profile.addresses.length === 0 ? (
          <EmptyState
            icon={MapPin}
            headline="No saved addresses"
            description="Addresses the customer saves at checkout will appear here."
          />
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border">
            {profile.addresses.map((address) => (
              <li key={address.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">{address.fullName}</p>
                  {address.isDefault ? <Badge variant="outline">Default</Badge> : null}
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.state}{" "}
                  {address.pincode}
                </p>
                <p className="text-xs text-muted-foreground">{address.phone}</p>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection title="Recent orders">
        {orders.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            headline="No orders yet"
            description="This customer hasn't placed any orders."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {orders.map((order) => (
                  <tr key={order.id} className="transition-colors hover:bg-muted/50">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <AdminStatusBadge
                        label={order.status}
                        tone={orderStatusTone(order.status)}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {formatAdminDate(order.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-foreground">
                      {formatPaise(order.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSection>

      <AdminSection title="Admin notes">
        {notes.length === 0 ? (
          <EmptyState
            icon={StickyNote}
            headline="No notes yet"
            description="Internal notes about this customer are only visible to admins."
          />
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border">
            {notes.map((note) => (
              <li
                key={note.id}
                className="flex items-start justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="text-foreground">{note.content}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatAdminDate(note.createdAt)}
                  </p>
                </div>
                {canWrite ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    aria-busy={busy === `note:${note.id}`}
                    className="shrink-0 text-xs font-medium text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      void confirm({
                        title: "Delete Note?",
                        description: "The note will be permanently removed.",
                        confirmLabel: "Delete Note",
                      }).then((ok) => {
                        if (!ok) return;
                        void mutate(
                          `note:${note.id}`,
                          () =>
                            api(`/admin/users/${customerId}/notes/${note.id}`, {
                              method: "DELETE",
                              idempotencyKey: createIdempotencyKey(),
                            }),
                          "Note deleted.",
                        );
                      });
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <form
            className="grid min-w-0 grid-cols-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const content = noteText.trim();
              if (!content) return;
              void mutate(
                "note",
                () =>
                  api(`/admin/users/${customerId}/notes`, {
                    method: "POST",
                    idempotencyKey: createIdempotencyKey(),
                    body: JSON.stringify({ content }),
                  }),
                "Note added.",
              ).then((ok) => {
                // Keep the typed note on failure so it can be retried.
                if (ok) setNoteText("");
              });
            }}
          >
            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              placeholder="Add an internal note about this customer…"
              aria-label="New admin note"
              disabled={busy === "note"}
              className="min-h-20 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              required
            />
            <Button
              type="submit"
              size="sm"
              className="w-fit"
              loading={busy === "note"}
              disabled={busy !== null && busy !== "note"}
            >
              Add note
            </Button>
          </form>
        ) : null}
      </AdminSection>

      {canWrite ? (
        <AdminSection
          title="Ban / unban"
          description="Banned customers can't sign in or place orders. Unbanning restores access immediately."
        >
          <div className="flex flex-wrap gap-2">
            {profile.isBanned ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={busy === "unban"}
                disabled={busy !== null && busy !== "unban"}
                onClick={() => {
                  void confirm({
                    title: "Unban Customer?",
                    description:
                      "The customer will be able to sign in and place orders again straight away.",
                    confirmLabel: "Unban Customer",
                    tone: "primary",
                  }).then((ok) => {
                    if (!ok) return;
                    void mutate(
                      "unban",
                      () =>
                        api(`/admin/users/${customerId}/ban`, {
                          method: "DELETE",
                          idempotencyKey: createIdempotencyKey(),
                        }),
                      "Customer unbanned.",
                    );
                  });
                }}
              >
                Unban customer
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                loading={busy === "ban"}
                disabled={busy !== null && busy !== "ban"}
                onClick={() => {
                  void confirm({
                    title: "Ban Customer?",
                    description:
                      "The customer will no longer be able to sign in or place orders. You can unban them later.",
                    confirmLabel: "Ban Customer",
                    icon: UserXIcon,
                    reasonLabel: "Reason (required)",
                    reasonPlaceholder: "e.g. repeated COD refusals, abusive behaviour…",
                  }).then((ok) => {
                    if (!ok) return;
                    void mutate(
                      "ban",
                      () =>
                        api(`/admin/users/${customerId}/ban`, {
                          method: "PATCH",
                          idempotencyKey: createIdempotencyKey(),
                          body: JSON.stringify({ reason: ok.reason }),
                        }),
                      "Customer banned.",
                    );
                  });
                }}
              >
                Ban customer
              </Button>
            )}
          </div>
        </AdminSection>
      ) : null}
    </div>
  );
}
