"use client";

import { type FormEvent, useEffect, useState } from "react";
import { OpsCriticalOtpForm } from "@/components/ops/OpsCriticalOtpForm";
import { useOpsCanWrite } from "@/components/ops/OpsSessionProvider";
import { useRouter } from "next/navigation";
import {
  OpsAlert,
  OpsBadge,
  OpsCard,
  OpsCardHeader,
  OpsDataTable,
  OpsField,
  OpsInput,
  OpsLoadingBlock,
} from "@/components/ops/ui/ops-ui";
import { Button } from "@/components/ui/button";
import { formatOpsDateTime, formatOpsRelativeExpiry } from "@/lib/ops-format";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { inviteStatusTone } from "@/lib/ops-status-maps";
import { ADMIN_PERMISSIONS } from "@/lib/permissions";
import {
  cleanupExpiredAdminInvitesClient,
  cleanupExpiredOpsInvitesClient,
  createAdminInviteClient,
  createOpsInviteClient,
  isOpsUnauthorisedError,
  listAdminInvitesClient,
  listOpsInvitesClient,
  revokeAdminInviteClient,
  revokeOpsInviteClient,
  type AdminInviteListItem,
  type OpsInviteListItem,
} from "@/lib/ops-client-api";

const REVOKABLE_STATUSES = new Set<OpsInviteListItem["status"]>(["CREATED", "EMAIL_SENT"]);
const ADMIN_REVOKABLE_STATUSES = new Set<AdminInviteListItem["status"]>(["CREATED", "EMAIL_SENT"]);
const ADMIN_PERMISSION_CHOICES = Object.values(ADMIN_PERMISSIONS);

export function OpsInvitesPanel() {
  const router = useRouter();
  const canWrite = useOpsCanWrite();
  const [opsItems, setOpsItems] = useState<OpsInviteListItem[]>([]);
  const [adminItems, setAdminItems] = useState<AdminInviteListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revokeOpsInviteId, setRevokeOpsInviteId] = useState<string | null>(null);
  const [revokeAdminInviteId, setRevokeAdminInviteId] = useState<string | null>(null);
  const [selectedAdminPermissions, setSelectedAdminPermissions] = useState<string[]>([
    ADMIN_PERMISSIONS.productsRead,
    ADMIN_PERMISSIONS.ordersRead,
    ADMIN_PERMISSIONS.inventoryRead,
    ADMIN_PERMISSIONS.settingsRead,
    ADMIN_PERMISSIONS.analyticsRead,
  ]);

  async function reload() {
    setError(null);
    await Promise.all([reloadOpsInvites(), reloadAdminInvites()]);
  }

  async function reloadOpsInvites() {
    try {
      const opsList = await listOpsInvitesClient({ limit: 50 });
      setOpsItems(Array.isArray(opsList.items) ? opsList.items : []);
    } catch (err) {
      if (isOpsUnauthorisedError(err)) {
        router.replace("/ops/login");
        return;
      }
      setError((prev) => prev ?? getApiErrorMessageWithHint(err));
    }
  }

  async function reloadAdminInvites() {
    try {
      const adminList = await listAdminInvitesClient({ limit: 50 });
      setAdminItems(Array.isArray(adminList.items) ? adminList.items : []);
    } catch (err) {
      if (isOpsUnauthorisedError(err)) {
        router.replace("/ops/login");
        return;
      }
      setError((prev) => prev ?? getApiErrorMessageWithHint(err));
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      await reloadOpsInvites();
      await reloadAdminInvites();
      if (!cancelled) {
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      const result = await createOpsInviteClient({
        email: String(formData.get("email") ?? ""),
        name: String(formData.get("name") ?? ""),
        setupBaseUrl: String(formData.get("setupBaseUrl") ?? ""),
        ipAllowlist: String(formData.get("ipAllowlist") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      });
      setMessage(
        `Invite created — expires ${formatOpsDateTime(result.expiresAt)}. Setup URL was emailed to the invitee.`,
      );
      await reload();
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    }
  }

  function toggleAdminPermission(permission: string) {
    setSelectedAdminPermissions((previous) =>
      previous.includes(permission)
        ? previous.filter((value) => value !== permission)
        : [...previous, permission],
    );
  }

  async function handleCreateAdminInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      const result = await createAdminInviteClient({
        email: String(formData.get("email") ?? ""),
        name: String(formData.get("name") ?? ""),
        setupBaseUrl: String(formData.get("setupBaseUrl") ?? ""),
        permissions: selectedAdminPermissions,
      });
      setMessage(
        `Merchant admin invite created — expires ${formatOpsDateTime(result.expiresAt)}.`,
      );
      await reload();
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    }
  }

  if (loading) {
    return <OpsLoadingBlock label="Loading invites…" />;
  }

  return (
    <div className="grid gap-6">
      {message ? <OpsAlert tone="success">{message}</OpsAlert> : null}
      {error ? <OpsAlert tone="error">{error}</OpsAlert> : null}

      {canWrite ? (
        <OpsCard>
          <OpsCardHeader
            title="Create invite"
            description="Ops operators only — not for merchant admins. setupBaseUrl is storefront origin only (no path). New ops users receive OPS_READ + OPS_WRITE."
          />
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <OpsField label="Email" htmlFor="invite-email">
              <OpsInput id="invite-email" name="email" type="email" required />
            </OpsField>
            <OpsField label="Name" htmlFor="invite-name">
              <OpsInput id="invite-name" name="name" required />
            </OpsField>
            <OpsField label="Setup base URL" htmlFor="invite-url" className="sm:col-span-2">
              <OpsInput
                id="invite-url"
                name="setupBaseUrl"
                placeholder="https://raghavaorganics.com"
                required
              />
            </OpsField>
            <OpsField label="IP allowlist" htmlFor="invite-ip" hint="Optional, comma-separated CIDRs">
              <OpsInput id="invite-ip" name="ipAllowlist" placeholder="203.0.113.10/32" />
            </OpsField>
            <div className="sm:col-span-2">
              <Button type="submit">Send invite</Button>
            </div>
          </form>
        </OpsCard>
      ) : (
        <OpsAlert tone="warning">Read-only — creating invites requires ops:write.</OpsAlert>
      )}

      <OpsCard>
        <OpsCardHeader
          title="Invite queue"
          description={`${opsItems.length} recent invites`}
          actions={
            canWrite ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void cleanupExpiredOpsInvitesClient()
                    .then((result) => setMessage(`Cleaned ${result.cleaned} expired invites.`))
                    .catch((err) => setError(getApiErrorMessageWithHint(err)))
                    .then(() => reload());
                }}
              >
                Cleanup expired
              </Button>
            ) : null
          }
        />
        <OpsDataTable
          rows={opsItems}
          rowKey={(row) => row.id}
          emptyTitle="No invites"
          emptyDescription="Create an invite to onboard a new operator."
          columns={[
            { key: "email", header: "Email", cell: (row) => row.inviteEmail },
            { key: "name", header: "Name", cell: (row) => row.inviteName },
            {
              key: "status",
              header: "Status",
              cell: (row) => <OpsBadge tone={inviteStatusTone(row.status)}>{row.status}</OpsBadge>,
            },
            {
              key: "expires",
              header: "Expires",
              cell: (row) => (
                <span className="text-muted-foreground">
                  {formatOpsRelativeExpiry(row.expiresAt)}
                </span>
              ),
            },
            {
              key: "id",
              header: "Invite ID",
              cell: (row) => <code className="text-xs text-muted-foreground">{row.id}</code>,
            },
            ...(canWrite
              ? [
                  {
                    key: "actions",
                    header: "Actions",
                    cell: (row: OpsInviteListItem) =>
                      REVOKABLE_STATUSES.has(row.status) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setRevokeOpsInviteId(row.id);
                            setMessage(null);
                            setError(null);
                          }}
                        >
                          Revoke…
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      ),
                  },
                ]
              : []),
          ]}
        />
      </OpsCard>

      {canWrite && revokeOpsInviteId ? (
        <OpsCriticalOtpForm
          actionType="invite-revoke"
          title="Revoke invite"
          description={`Cancels invite ${revokeOpsInviteId} before it is consumed.`}
          buttonLabel="Confirm revoke"
          variant="danger"
          onExecute={async ({ challengeId, otpCode }) => {
            await revokeOpsInviteClient({ inviteId: revokeOpsInviteId, challengeId, otpCode });
            setRevokeOpsInviteId(null);
            setMessage("Invite revoked.");
            await reload();
          }}
        >
          <OpsField label="Invite ID" htmlFor="revoke-invite-id">
            <OpsInput
              id="revoke-invite-id"
              value={revokeOpsInviteId}
              readOnly
              className="font-mono text-xs"
            />
          </OpsField>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRevokeOpsInviteId(null)}>
            Cancel revoke
          </Button>
        </OpsCriticalOtpForm>
      ) : null}

      {canWrite ? (
        <OpsCard>
          <OpsCardHeader
            title="Create merchant admin invite"
            description="Bootstraps merchant admins at /admin/setup. Deactivated merchant admin emails can be re-invited here—the same account is reactivated (audit history kept)."
          />
          <form onSubmit={handleCreateAdminInvite} className="grid gap-4 sm:grid-cols-2">
            <OpsField label="Admin email" htmlFor="admin-invite-email">
              <OpsInput id="admin-invite-email" name="email" type="email" required />
            </OpsField>
            <OpsField label="Admin name" htmlFor="admin-invite-name">
              <OpsInput id="admin-invite-name" name="name" required />
            </OpsField>
            <OpsField label="Setup base URL" htmlFor="admin-invite-url" className="sm:col-span-2">
              <OpsInput
                id="admin-invite-url"
                name="setupBaseUrl"
                placeholder="https://raghavaorganics.com"
                required
              />
            </OpsField>
            <div className="sm:col-span-2 grid gap-2">
              <p className="text-sm font-medium">Permissions</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {ADMIN_PERMISSION_CHOICES.map((permission) => (
                  <label key={permission} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={selectedAdminPermissions.includes(permission)}
                      onChange={() => toggleAdminPermission(permission)}
                    />
                    <span>{permission}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={selectedAdminPermissions.length === 0}>
                Send merchant admin invite
              </Button>
            </div>
          </form>
        </OpsCard>
      ) : null}

      <OpsCard>
        <OpsCardHeader
          title="Merchant admin invites"
          description={`${adminItems.length} recent merchant-admin invites`}
          actions={
            canWrite ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void cleanupExpiredAdminInvitesClient()
                    .then((result) => setMessage(`Cleaned ${result.cleaned} expired merchant-admin invites.`))
                    .catch((err) => setError(getApiErrorMessageWithHint(err)))
                    .then(() => reload());
                }}
              >
                Cleanup expired
              </Button>
            ) : null
          }
        />
        <OpsDataTable
          rows={adminItems}
          rowKey={(row) => row.id}
          emptyTitle="No merchant admin invites"
          emptyDescription="Create an invite to onboard a merchant admin user."
          columns={[
            { key: "email", header: "Email", cell: (row) => row.inviteEmail },
            { key: "name", header: "Name", cell: (row) => row.inviteName },
            {
              key: "status",
              header: "Status",
              cell: (row) => <OpsBadge tone={inviteStatusTone(row.status)}>{row.status}</OpsBadge>,
            },
            {
              key: "permissions",
              header: "Permissions",
              cell: (row) => <span className="text-xs text-muted-foreground">{row.permissions.join(", ")}</span>,
            },
            {
              key: "expires",
              header: "Expires",
              cell: (row) => (
                <span className="text-muted-foreground">
                  {formatOpsRelativeExpiry(row.expiresAt)}
                </span>
              ),
            },
            ...(canWrite
              ? [
                  {
                    key: "actions",
                    header: "Actions",
                    cell: (row: AdminInviteListItem) =>
                      ADMIN_REVOKABLE_STATUSES.has(row.status) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setRevokeAdminInviteId(row.id);
                            setMessage(null);
                            setError(null);
                          }}
                        >
                          Revoke…
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      ),
                  },
                ]
              : []),
          ]}
        />
      </OpsCard>

      {canWrite && revokeAdminInviteId ? (
        <OpsCriticalOtpForm
          actionType="invite-revoke"
          title="Revoke merchant admin invite"
          description={`Cancels merchant-admin invite ${revokeAdminInviteId} before setup.`}
          buttonLabel="Confirm revoke"
          variant="danger"
          onExecute={async ({ challengeId, otpCode }) => {
            await revokeAdminInviteClient({ inviteId: revokeAdminInviteId, challengeId, otpCode });
            setRevokeAdminInviteId(null);
            setMessage("Merchant admin invite revoked.");
            await reload();
          }}
        >
          <OpsField label="Invite ID" htmlFor="revoke-admin-invite-id">
            <OpsInput
              id="revoke-admin-invite-id"
              value={revokeAdminInviteId}
              readOnly
              className="font-mono text-xs"
            />
          </OpsField>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRevokeAdminInviteId(null)}>
            Cancel revoke
          </Button>
        </OpsCriticalOtpForm>
      ) : null}
    </div>
  );
}
