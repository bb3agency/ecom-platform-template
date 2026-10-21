"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, UserPlus } from "lucide-react";
import { OpsOtpDialog } from "@/components/ops/OpsOtpDialog";
import { OpsPersonCell } from "@/components/ops/OpsPersonCell";
import { OpsReasonField, REASON_MIN_LENGTH } from "@/components/ops/OpsReasonField";
import { useOpsCanWrite, useOpsSession } from "@/components/ops/OpsSessionProvider";
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
import { deactivateOpsUserClient, listOpsUsersClient, type OpsUserListItem } from "@/lib/ops-client-api";

export function OpsUsersPanel() {
  const session = useOpsSession();
  const canWrite = useOpsCanWrite();
  const [users, setUsers] = useState<OpsUserListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<OpsUserListItem | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listOpsUsersClient({ limit: 100 });
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

  const activeCount = users.filter((u) => u.isActive).length;

  const columns: DataColumn<OpsUserListItem>[] = [
    {
      key: "operator",
      header: "Operator",
      hideOnMobile: true,
      cell: (row) => <OpsPersonCell name={row.name} email={row.email} you={row.id === session.id} />,
    },
    {
      key: "access",
      header: "Access",
      cell: (row) => (row.permissions.includes("ops:write") ? "View and change" : "View only"),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusDot tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Deactivated"}</StatusDot>,
    },
    {
      key: "login",
      header: "Last sign-in",
      cell: (row) => (
        <span title={row.lastLoginAt ? formatOpsDateTime(row.lastLoginAt) : undefined}>
          {row.lastLoginAt ? formatRelativeTime(row.lastLoginAt) : "Never"}
        </span>
      ),
    },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: <span className="sr-only">Actions</span>,
            mobileLabel: "Actions",
            align: "right" as const,
            hideOnMobile: true,
            cell: (row: OpsUserListItem) =>
              row.isActive && row.id !== session.id ? (
                <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => openDeactivate(row)}>
                  Deactivate
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  function openDeactivate(user: OpsUserListItem) {
    setMessage(null);
    setReason("");
    setTarget(user);
  }

  return (
    <ConsolePage>
      <PageHeader
        title="Operators"
        description="People who can sign in to this ops console."
        meta={!loading ? <span className="text-sm text-muted-foreground tabular">{activeCount} active</span> : null}
        actions={
          canWrite ? (
            <Link href="/ops/invites?invite=operator" className={cn(buttonVariants(), "gap-1.5")}>
              <UserPlus aria-hidden />
              Invite operator
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
          caption="Ops operators"
          mobileTitle={(row) => (
            <div className="flex min-w-0 items-center justify-between gap-3">
              <OpsPersonCell name={row.name} email={row.email} you={row.id === session.id} />
              {canWrite && row.isActive && row.id !== session.id ? (
                <Button type="button" variant="outline" size="sm" className="shrink-0 text-destructive" onClick={() => openDeactivate(row)}>
                  Deactivate
                </Button>
              ) : null}
            </div>
          )}
          empty={<p className="text-sm text-muted-foreground">No operators yet. Invite one to share the work.</p>}
        />
      </Panel>

      <OpsOtpDialog
        open={target !== null}
        onOpenChange={(open) => (!open ? setTarget(null) : undefined)}
        action="user-deactivate"
        title="Deactivate this operator?"
        description="They're signed out and can't sign in again. To restore access, send a new invite."
        confirmLabel="Deactivate"
        tone="danger"
        canProceed={reason.trim().length >= REASON_MIN_LENGTH}
        proceedHint={`Add a reason of at least ${REASON_MIN_LENGTH} characters to continue.`}
        onConfirm={async ({ challengeId, otpCode }) => {
          if (!target) return;
          await deactivateOpsUserClient({ opsUserId: target.id, reason: reason.trim(), challengeId, otpCode });
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
            <OpsReasonField id="deactivate-operator-reason" value={reason} onChange={setReason} />
          </>
        ) : null}
      </OpsOtpDialog>
    </ConsolePage>
  );
}
