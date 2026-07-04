"use client";

import { useEffect, useState } from "react";
import { OpsCriticalOtpForm } from "@/components/ops/OpsCriticalOtpForm";
import { useOpsCanWrite, useOpsSession } from "@/components/ops/OpsSessionProvider";
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
  deactivateOpsUserClient,
  listOpsUsersClient,
  type OpsUserListItem,
} from "@/lib/ops-client-api";

export function OpsUsersPanel() {
  const session = useOpsSession();
  const canWrite = useOpsCanWrite();
  const [users, setUsers] = useState<OpsUserListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deactivateUser, setDeactivateUser] = useState<OpsUserListItem | null>(null);

  async function reload() {
    const result = await listOpsUsersClient({ limit: 50 });
    setUsers(Array.isArray(result.items) ? result.items : []);
  }

  useEffect(() => {
    let active = true;

    async function loadUsers() {
      try {
        const result = await listOpsUsersClient({ limit: 50 });
        if (active) setUsers(Array.isArray(result.items) ? result.items : []);
      } catch (err) {
        if (active) setError(getApiErrorMessageWithHint(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadUsers();

    return () => { active = false; };
  }, []);

  if (loading) {
    return <OpsLoadingBlock label="Loading operators…" />;
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      {message ? <OpsAlert tone="success">{message}</OpsAlert> : null}
      {error ? <OpsAlert tone="error">{error}</OpsAlert> : null}

      <OpsCard>
        <OpsCardHeader title="Operators" description={`${users.length} accounts`} />
        <OpsDataTable
          rows={users}
          rowKey={(row) => row.id}
          mobileCardTitle={(row) => row.name}
          mobileCardDescription={(row) => row.email}
          emptyTitle="No operators"
          emptyDescription="Invite operators from the invites screen to grant ops access."
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
              key: "perms",
              header: "Permissions",
              cell: (row) => (
                <div className="flex flex-wrap gap-1">
                  {row.permissions.map((p) => (
                    <OpsBadge key={p} tone="info">
                      {p}
                    </OpsBadge>
                  ))}
                </div>
              ),
            },
            {
              key: "login",
              header: "Last login",
              cell: (row) => formatOpsDateTime(row.lastLoginAt),
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
                    cell: (row: OpsUserListItem) => {
                      if (!row.isActive || row.id === session.id) {
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
          actionType="user-deactivate"
          title="Deactivate operator"
          description={`Deactivates ${deactivateUser.name} (${deactivateUser.email}). They must be re-invited to return.`}
          buttonLabel="Confirm deactivation"
          variant="danger"
          onExecute={async ({ challengeId, otpCode }) => {
            const reason = String(
              (document.getElementById("deactivate-reason") as HTMLTextAreaElement | null)?.value ??
                "",
            ).trim();
            await deactivateOpsUserClient({
              opsUserId: deactivateUser.id,
              reason,
              challengeId,
              otpCode,
            });
            setDeactivateUser(null);
            setMessage(`${deactivateUser.email} was deactivated.`);
            await reload();
          }}
        >
          <OpsField label="Ops user ID" htmlFor="deactivate-user-id">
            <OpsInput
              id="deactivate-user-id"
              value={deactivateUser.id}
              readOnly
              className="font-mono text-xs"
            />
          </OpsField>
          <OpsField label="Reason" htmlFor="deactivate-reason" hint="Minimum 10 characters">
            <OpsTextarea id="deactivate-reason" minLength={10} required />
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
