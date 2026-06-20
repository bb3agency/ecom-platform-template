"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminSection } from "@/components/admin/AdminSection";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { Button } from "@/components/ui/button";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { createIdempotencyKey } from "@/lib/idempotency";
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
  const [banReason, setBanReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canWrite = hasAdminPermission(user, ADMIN_PERMISSIONS.usersWrite);

  const load = useCallback(async () => {
    setLoading(true);
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
    <div className="grid gap-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      <AdminSection title="Profile">
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Name:</span> {profile.firstName}{" "}
            {profile.lastName}
          </p>
          <p>
            <span className="text-muted-foreground">Email:</span> {profile.email ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Phone:</span> {profile.phone ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Joined:</span>{" "}
            {formatAdminDate(profile.createdAt)}
          </p>
          {profile.isBanned ? (
            <div className="space-y-1 sm:col-span-2">
              <AdminStatusBadge label="Banned" tone="destructive" />
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
        </div>
      </AdminSection>

      <AdminSection
        title="Addresses"
        empty={profile.addresses.length === 0}
        emptyMessage="No saved addresses."
      >
        <ul className="divide-y divide-border rounded-md border border-border">
          {profile.addresses.map((address) => (
            <li key={address.id} className="px-3 py-2 text-sm">
              <p className="font-medium">
                {address.fullName}
                {address.isDefault ? (
                  <span className="ml-2 text-xs text-muted-foreground">(default)</span>
                ) : null}
              </p>
              <p className="text-muted-foreground">
                {address.line1}
                {address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.state}{" "}
                {address.pincode}
              </p>
              <p className="text-xs text-muted-foreground">{address.phone}</p>
            </li>
          ))}
        </ul>
      </AdminSection>

      <AdminSection
        title="Recent orders"
        empty={orders.length === 0}
        emptyMessage="No orders yet."
      >
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Order</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="text-primary hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <AdminStatusBadge
                      label={order.status}
                      tone={orderStatusTone(order.status)}
                    />
                  </td>
                  <td className="px-3 py-2">{formatPaise(order.total)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatAdminDate(order.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminSection>

      <AdminSection title="Admin notes" empty={notes.length === 0} emptyMessage="No notes yet.">
        <ul className="mb-4 divide-y divide-border rounded-md border border-border">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <p>{note.content}</p>
                <p className="text-xs text-muted-foreground">{formatAdminDate(note.createdAt)}</p>
              </div>
              {canWrite ? (
                <button
                  type="button"
                  className="shrink-0 text-xs text-destructive"
                  onClick={() => {
                    if (!window.confirm("Delete this note?")) return;
                    void api(`/admin/users/${customerId}/notes/${note.id}`, {
                      method: "DELETE",
                      idempotencyKey: createIdempotencyKey(),
                    })
                      .then(() => {
                        setMessage("Note deleted.");
                        notifyAdminDataChanged(["customers", "dashboard"]);
                        return load();
                      })
                      .catch((err) => setError(getApiErrorMessageWithHint(err)));
                  }}
                >
                  Delete
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {canWrite ? (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void api(`/admin/users/${customerId}/notes`, {
                method: "POST",
                idempotencyKey: createIdempotencyKey(),
                body: JSON.stringify({ content: noteText }),
              })
                .then(() => {
                  setMessage("Note added.");
                  setNoteText("");
                  notifyAdminDataChanged(["customers", "dashboard"]);
                  return load();
                })
                .catch((err) => setError(getApiErrorMessageWithHint(err)));
            }}
          >
            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              className="min-h-20 rounded-md border px-3 py-2 text-sm"
              required
            />
            <Button type="submit" size="sm" className="w-fit">
              Add note
            </Button>
          </form>
        ) : null}
      </AdminSection>

      {canWrite ? (
        <AdminSection title="Ban / unban">
          <textarea
            value={banReason}
            onChange={(event) => setBanReason(event.target.value)}
            placeholder="Ban reason (required for ban)"
            className="mb-3 min-h-20 w-full rounded-md border px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                void api(`/admin/users/${customerId}/ban`, {
                  method: "PATCH",
                  idempotencyKey: createIdempotencyKey(),
                  body: JSON.stringify({ reason: banReason }),
                })
                  .then(() => {
                    setMessage("Customer banned.");
                    notifyAdminDataChanged(["customers", "dashboard"]);
                    return load();
                  })
                  .catch((err) => setError(getApiErrorMessageWithHint(err)));
              }}
            >
              Ban customer
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void api(`/admin/users/${customerId}/ban`, {
                  method: "DELETE",
                  idempotencyKey: createIdempotencyKey(),
                })
                  .then(() => {
                    setMessage("Customer unbanned.");
                    notifyAdminDataChanged(["customers", "dashboard"]);
                    return load();
                  })
                  .catch((err) => setError(getApiErrorMessageWithHint(err)));
              }}
            >
              Unban
            </Button>
          </div>
        </AdminSection>
      ) : null}
    </div>
  );
}
