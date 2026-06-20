"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OpsCriticalOtpForm } from "@/components/ops/OpsCriticalOtpForm";
import { useOpsCanWrite } from "@/components/ops/OpsSessionProvider";
import {
  OpsAlert,
  OpsBadge,
  OpsCard,
  OpsCardHeader,
  OpsDataTable,
  OpsField,
  OpsInput,
  OpsLoadingBlock,
  OpsTextarea,
} from "@/components/ops/ui/ops-ui";
import { Button } from "@/components/ui/button";
import { formatOpsDateTime } from "@/lib/ops-format";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import {
  deactivateMerchantAdminUserClient,
  listMerchantAdminUsersClient,
  type MerchantAdminUserListItem,
} from "@/lib/ops-client-api";

export function OpsAdminUsersPanel() {
  const canWrite = useOpsCanWrite();
  const [users, setUsers] = useState<MerchantAdminUserListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deactivateUser, setDeactivateUser] = useState<MerchantAdminUserListItem | null>(null);

  async function reload() {
    const result = await listMerchantAdminUsersClient({ limit: 50 });
    setUsers(Array.isArray(result.items) ? result.items : []);
  }

  useEffect(() => {
    let active = true;

    async function loadUsers() {
      try {
        const result = await listMerchantAdminUsersClient({ limit: 50 });
        if (active) setUsers(Array.isArray(result.items) ? result.items : []);
      } catch (err) {
        if (active) setError(getApiErrorMessageWithHint(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadUsers();

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <OpsLoadingBlock label="Loading merchant admins…" />;
  }

  return (
    <div className="grid gap-6">
      {message ? <OpsAlert tone="success">{message}</OpsAlert> : null}
      {error ? <OpsAlert tone="error">{error}</OpsAlert> : null}

      <OpsAlert tone="info">
        Merchant admins sign in at <code className="text-xs">/admin/login</code>. To onboard a new
        admin, create an invite on the{" "}
        <Link href="/ops/invites" className="underline underline-offset-2">
          Invites
        </Link>{" "}
        page (merchant admin invite section). Deactivated admins cannot log in until that invite is
        completed — setup reactivates the same account.
      </OpsAlert>

      <OpsCard>
        <OpsCardHeader
          title="Merchant admins"
          description={`${users.length} accounts with role ADMIN`}
        />
        <OpsDataTable
          rows={users}
          rowKey={(row) => row.id}
          mobileCardTitle={(row) => row.name}
          mobileCardDescription={(row) => row.email}
          emptyTitle="No merchant admins"
          emptyDescription="Create an admin invite to provision the first merchant account."
          columns={[
            { key: "name", header: "Name", cell: (row) => row.name },
            {
              key: "email",
              header: "Email",
              cell: (row) => <span className="break-all">{row.email}</span>,
            },
            {
              key: "active",
              header: "Status",
              cell: (row) => (
                <OpsBadge tone={row.isActive ? "success" : "muted"}>
                  {row.isActive ? "Active" : "Inactive"}
                </OpsBadge>
              ),
            },
            {
              key: "verified",
              header: "Verified",
              cell: (row) => (
                <OpsBadge tone={row.isVerified ? "info" : "warning"}>
                  {row.isVerified ? "Yes" : "No"}
                </OpsBadge>
              ),
            },
            {
              key: "perms",
              header: "Permissions",
              cell: (row) => (
                <div className="flex max-w-xs flex-wrap gap-1">
                  {row.permissions.length > 0 ? (
                    row.permissions.map((p) => (
                      <OpsBadge key={p} tone="info">
                        {p}
                      </OpsBadge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">No grants</span>
                  )}
                </div>
              ),
            },
            {
              key: "created",
              header: "Created",
              cell: (row) => formatOpsDateTime(row.createdAt),
            },
            {
              key: "id",
              header: "ID",
              cell: (row) => (
                <code className="break-all text-xs text-muted-foreground">{row.id}</code>
              ),
            },
            ...(canWrite
              ? [
                  {
                    key: "actions",
                    header: "Actions",
                    cell: (row: MerchantAdminUserListItem) => {
                      if (!row.isActive) {
                        return <span className="text-xs text-muted-foreground">—</span>;
                      }
                      return (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setDeactivateUser(row);
                            setMessage(null);
                            setError(null);
                          }}
                        >
                          Deactivate…
                        </Button>
                      );
                    },
                  },
                ]
              : []),
          ]}
        />
      </OpsCard>

      {canWrite && deactivateUser ? (
        <OpsCriticalOtpForm
          actionType="admin-user-deactivate"
          title="Deactivate merchant admin"
          description={`Deactivates ${deactivateUser.name} (${deactivateUser.email}). They lose admin access immediately; issue a new invite to restore access.`}
          buttonLabel="Confirm deactivation"
          variant="danger"
          onExecute={async ({ challengeId, otpCode }) => {
            const reason = String(
              (document.getElementById("admin-deactivate-reason") as HTMLTextAreaElement | null)
                ?.value ?? "",
            ).trim();
            await deactivateMerchantAdminUserClient({
              adminUserId: deactivateUser.id,
              reason,
              challengeId,
              otpCode,
            });
            setDeactivateUser(null);
            setMessage(`${deactivateUser.email} was deactivated.`);
            await reload();
          }}
        >
          <OpsField label="Admin user ID" htmlFor="admin-deactivate-user-id">
            <OpsInput
              id="admin-deactivate-user-id"
              value={deactivateUser.id}
              readOnly
              className="font-mono text-xs"
            />
          </OpsField>
          <OpsField label="Reason" htmlFor="admin-deactivate-reason" hint="Minimum 10 characters">
            <OpsTextarea id="admin-deactivate-reason" minLength={10} required />
          </OpsField>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDeactivateUser(null)}>
            Cancel
          </Button>
        </OpsCriticalOtpForm>
      ) : canWrite ? null : (
        <OpsAlert tone="warning">Read-only — deactivation requires ops:write.</OpsAlert>
      )}
    </div>
  );
}
