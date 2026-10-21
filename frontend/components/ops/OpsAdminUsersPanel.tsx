"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, UserPlus } from "lucide-react";
import { OpsOtpDialog } from "@/components/ops/OpsOtpDialog";
import { OpsPersonCell } from "@/components/ops/OpsPersonCell";
import { OpsReasonField, REASON_MIN_LENGTH } from "@/components/ops/OpsReasonField";
import { useOpsCanWrite } from "@/components/ops/OpsSessionProvider";
import { OpsLoadError, formatRelativeTime } from "@/components/ops/ui/ops-ui";
import {
  ConsolePage,
  DataTable,
  KeyValueList,
  Notice,
  PageHeader,
  Panel,
  StatusDot,
  type DataColumn,
} from "@/components/ui/console";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatOpsDateTime } from "@/lib/ops-format";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import {
  deactivateMerchantAdminUserClient,
  listMerchantAdminUsersClient,
  type MerchantAdminUserListItem,
} from "@/lib/ops-client-api";

function permissionSummary(permissions: string[]): string {
  if (permissions.length === 0) return "No permissions";
  const areas = new Set(permissions.map((p) => p.split(":")[0]));
  return `${permissions.length} permissions · ${areas.size} ${areas.size === 1 ? "area" : "areas"}`;
}

export function OpsAdminUsersPanel() {
  const canWrite = useOpsCanWrite();
  const [users, setUsers] = useState<MerchantAdminUserListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<MerchantAdminUserListItem | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listMerchantAdminUsersClient({ limit: 100 });
      setUsers(Array.isArray(result.items) ? result.items : []);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function openDeactivate(user: MerchantAdminUserListItem) {
    setMessage(null);
    setReason("");
    setTarget(user);
  }

  const activeCount = users.filter((u) => u.isActive).length;

  const columns: DataColumn<MerchantAdminUserListItem>[] = [
    {
      key: "admin",
      header: "Admin",
      hideOnMobile: true,
      cell: (row) => <OpsPersonCell name={row.name} email={row.email} />,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) =>
        row.isActive ? (
          <StatusDot tone={row.isVerified ? "success" : "warning"}>{row.isVerified ? "Active" : "Setup not finished"}</StatusDot>
        ) : (
          <StatusDot tone="neutral" title={row.deactivatedReason ?? undefined}>
            Deactivated
          </StatusDot>
        ),
    },
    {
      key: "permissions",
      header: "Permissions",
      cell: (row) => (
        <span title={row.permissions.join(", ")} className="text-muted-foreground">
          {permissionSummary(row.permissions)}
        </span>
      ),
    },
    {
      key: "created",
      header: "Added",
      hideBelow: "lg",
      cell: (row) => <span title={formatOpsDateTime(row.createdAt)}>{formatRelativeTime(row.createdAt)}</span>,
    },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: <span className="sr-only">Actions</span>,
            align: "right" as const,
            hideOnMobile: true,
            cell: (row: MerchantAdminUserListItem) =>
              row.isActive ? (
                <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => openDeactivate(row)}>
                  Deactivate
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <ConsolePage>
      <PageHeader
        title="Merchant admins"
        description="Store staff who sign in at /admin. Deactivating signs them out everywhere."
        meta={!loading ? <span className="text-sm text-muted-foreground tabular">{activeCount} active</span> : null}
        actions={
          canWrite ? (
            <Link href="/ops/invites?invite=admin" className={cn(buttonVariants(), "gap-1.5")}>
              <UserPlus aria-hidden />
              Invite merchant admin
            </Link>
          ) : null
        }
      />

      {message ? (
        <Notice tone="success" icon={CircleCheck}>
          {message}
        </Notice>
      ) : null}
      {error ? <OpsLoadError message={error} onRetry={() => void load()} /> : null}

      <Panel flush>
        <DataTable
          rows={users}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          caption="Merchant admin accounts"
          mobileTitle={(row) => (
            <div className="flex min-w-0 items-center justify-between gap-3">
              <OpsPersonCell name={row.name} email={row.email} />
              {canWrite && row.isActive ? (
                <Button type="button" variant="outline" size="sm" className="shrink-0 text-destructive" onClick={() => openDeactivate(row)}>
                  Deactivate
                </Button>
              ) : null}
            </div>
          )}
          empty={
            <p className="text-sm text-muted-foreground">
              No merchant admins yet. Invite the store owner so they can manage orders and products.
            </p>
          }
        />
      </Panel>

      <p className="text-sm text-muted-foreground">
        A deactivated admin can be brought back with a new invite to the same email — their history is kept.
      </p>

      <OpsOtpDialog
        open={target !== null}
        onOpenChange={(open) => (!open ? setTarget(null) : undefined)}
        action="admin-user-deactivate"
        title="Deactivate this merchant admin?"
        description="They lose admin access immediately and are signed out of every device."
        confirmLabel="Deactivate"
        tone="danger"
        canProceed={reason.trim().length >= REASON_MIN_LENGTH}
        proceedHint={`Add a reason of at least ${REASON_MIN_LENGTH} characters to continue.`}
        onConfirm={async ({ challengeId, otpCode }) => {
          if (!target) return;
          await deactivateMerchantAdminUserClient({ adminUserId: target.id, reason: reason.trim(), challengeId, otpCode });
          setMessage(`${target.name} was deactivated.`);
          await load();
        }}
      >
        {target ? (
          <>
            <KeyValueList
              items={[
                { label: "Name", value: target.name },
                { label: "Email", value: target.email },
              ]}
            />
            <OpsReasonField id="deactivate-admin-reason" value={reason} onChange={setReason} />
          </>
        ) : null}
      </OpsOtpDialog>
    </ConsolePage>
  );
}
