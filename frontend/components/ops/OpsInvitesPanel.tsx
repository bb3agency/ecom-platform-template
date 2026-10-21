"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Store, UserPlus } from "lucide-react";
import { OpsAdminInviteForm } from "@/components/ops/OpsAdminInviteForm";
import { OpsOperatorInviteForm } from "@/components/ops/OpsOperatorInviteForm";
import { OpsOtpDialog } from "@/components/ops/OpsOtpDialog";
import { OpsPersonCell } from "@/components/ops/OpsPersonCell";
import { useOpsCanWrite } from "@/components/ops/OpsSessionProvider";
import { OPS_SIDE_SHEET_CLASS, OpsLoadError, OpsReadOnlyNotice, formatRelativeTime } from "@/components/ops/ui/ops-ui";
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
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatOpsDateTime, formatOpsRelativeExpiry } from "@/lib/ops-format";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { INVITE_STATUS_LABELS, inviteStatusTone } from "@/lib/ops-status-maps";
import {
  cleanupExpiredAdminInvitesClient,
  cleanupExpiredOpsInvitesClient,
  isOpsUnauthorisedError,
  listAdminInvitesClient,
  listOpsInvitesClient,
  revokeAdminInviteClient,
  revokeOpsInviteClient,
  type AdminInviteListItem,
  type OpsInviteListItem,
} from "@/lib/ops-client-api";

type InviteKind = "operator" | "admin";
type InviteRow = OpsInviteListItem | AdminInviteListItem;

const REVOKABLE = new Set<InviteRow["status"]>(["CREATED", "EMAIL_SENT"]);

function isOpen(row: InviteRow): boolean {
  return REVOKABLE.has(row.status) && new Date(row.expiresAt).getTime() > Date.now();
}

function statusLabel(row: InviteRow): string {
  if (REVOKABLE.has(row.status) && new Date(row.expiresAt).getTime() <= Date.now()) return "Expired";
  return INVITE_STATUS_LABELS[row.status];
}

function statusTone(row: InviteRow) {
  return statusLabel(row) === "Expired" ? "neutral" : inviteStatusTone(row.status);
}

interface OpsInvitesPanelProps {
  initialInvite?: InviteKind | null;
}

export function OpsInvitesPanel({ initialInvite = null }: OpsInvitesPanelProps) {
  const router = useRouter();
  const canWrite = useOpsCanWrite();
  const [tab, setTab] = useState<InviteKind>(initialInvite ?? "operator");
  const [opsItems, setOpsItems] = useState<OpsInviteListItem[]>([]);
  const [adminItems, setAdminItems] = useState<AdminInviteListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState<InviteKind | null>(canWrite ? initialInvite : null);
  const [revoke, setRevoke] = useState<{ kind: InviteKind; row: InviteRow } | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ops, admins] = await Promise.all([listOpsInvitesClient({ limit: 50 }), listAdminInvitesClient({ limit: 50 })]);
      setOpsItems(Array.isArray(ops.items) ? ops.items : []);
      setAdminItems(Array.isArray(admins.items) ? admins.items : []);
      setError(null);
    } catch (err) {
      if (isOpsUnauthorisedError(err)) {
        router.replace("/ops/login");
        return;
      }
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function cleanup(kind: InviteKind) {
    setCleaning(true);
    setMessage(null);
    try {
      const result = kind === "operator" ? await cleanupExpiredOpsInvitesClient() : await cleanupExpiredAdminInvitesClient();
      setMessage(
        result.cleaned === 0
          ? "No expired invites to clear."
          : `Cleared ${result.cleaned} expired ${result.cleaned === 1 ? "invite" : "invites"}.`,
      );
      await load();
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setCleaning(false);
    }
  }

  function columns(kind: InviteKind): DataColumn<InviteRow>[] {
    return [
      {
        key: "who",
        header: "Invitee",
        hideOnMobile: true,
        cell: (row) => <OpsPersonCell name={row.inviteName} email={row.inviteEmail} />,
      },
      {
        key: "status",
        header: "Status",
        cell: (row) => <StatusDot tone={statusTone(row)}>{statusLabel(row)}</StatusDot>,
      },
      {
        key: "expires",
        header: "When",
        cell: (row) =>
          isOpen(row) ? (
            <span title={formatOpsDateTime(row.expiresAt)}>{formatOpsRelativeExpiry(row.expiresAt)}</span>
          ) : (
            <span className="text-muted-foreground" title={formatOpsDateTime(row.createdAt)}>
              Sent {formatRelativeTime(row.createdAt)}
            </span>
          ),
      },
      ...(kind === "admin"
        ? [
            {
              key: "permissions",
              header: "Permissions",
              hideBelow: "lg" as const,
              cell: (row: InviteRow) =>
                "permissions" in row ? (
                  <span className="text-muted-foreground" title={row.permissions.join(", ")}>
                    {row.permissions.length}
                  </span>
                ) : null,
            },
          ]
        : []),
      ...(canWrite
        ? [
            {
              key: "actions",
              header: <span className="sr-only">Actions</span>,
              align: "right" as const,
              hideOnMobile: true,
              cell: (row: InviteRow) =>
                isOpen(row) ? (
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setRevoke({ kind, row })}>
                    Revoke
                  </Button>
                ) : null,
            },
          ]
        : []),
    ];
  }

  function list(kind: InviteKind) {
    const rows: InviteRow[] = kind === "operator" ? opsItems : adminItems;
    return (
      <Panel
        flush
        footer={
          canWrite ? (
            <>
              <p className="text-xs text-muted-foreground">Showing the 50 most recent invites.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void cleanup(kind)} disabled={cleaning}>
                Clear expired
              </Button>
            </>
          ) : undefined
        }
      >
        <DataTable
          rows={rows}
          columns={columns(kind)}
          rowKey={(row) => row.id}
          loading={loading}
          caption={kind === "operator" ? "Operator invites" : "Merchant admin invites"}
          mobileTitle={(row) => (
            <div className="flex min-w-0 items-center justify-between gap-3">
              <OpsPersonCell name={row.inviteName} email={row.inviteEmail} />
              {canWrite && isOpen(row) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-destructive"
                  onClick={() => setRevoke({ kind, row })}
                >
                  Revoke
                </Button>
              ) : null}
            </div>
          )}
          empty={
            <p className="text-sm text-muted-foreground">
              {kind === "operator"
                ? "No operator invites yet."
                : "No merchant admin invites yet. Invite the store owner to get them started."}
            </p>
          }
        />
      </Panel>
    );
  }

  const openOps = opsItems.filter(isOpen).length;
  const openAdmins = adminItems.filter(isOpen).length;

  return (
    <ConsolePage>
      <PageHeader
        title="Invites"
        description="Bring new operators and merchant admins on board. Setup links expire after 10 minutes."
        actions={
          canWrite ? (
            <>
              <Button type="button" variant="outline" onClick={() => setFormOpen("admin")} className="gap-1.5">
                <Store aria-hidden />
                Invite merchant admin
              </Button>
              <Button type="button" onClick={() => setFormOpen("operator")} className="gap-1.5">
                <UserPlus aria-hidden />
                Invite operator
              </Button>
            </>
          ) : null
        }
      />

      {!canWrite ? <OpsReadOnlyNotice>Sending and revoking invites needs write access (ops:write).</OpsReadOnlyNotice> : null}
      {message ? (
        <Notice tone="success" icon={CircleCheck}>
          {message}
        </Notice>
      ) : null}
      {error ? <OpsLoadError message={error} onRetry={() => void load()} /> : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as InviteKind)}>
        <TabsList className="overflow-x-auto scrollbar-hide">
          <TabsTrigger value="operator" className="min-h-11">
            Operators
            {openOps > 0 ? <span className="text-xs font-normal text-muted-foreground tabular">{openOps} open</span> : null}
          </TabsTrigger>
          <TabsTrigger value="admin" className="min-h-11">
            Merchant admins
            {openAdmins > 0 ? <span className="text-xs font-normal text-muted-foreground tabular">{openAdmins} open</span> : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="operator">{list("operator")}</TabsContent>
        <TabsContent value="admin">{list("admin")}</TabsContent>
      </Tabs>

      <Sheet open={formOpen !== null} onOpenChange={(open) => (!open ? setFormOpen(null) : undefined)}>
        <SheetContent className={OPS_SIDE_SHEET_CLASS}>
          {formOpen === "operator" ? (
            <OpsOperatorInviteForm
              onCancel={() => setFormOpen(null)}
              onCreated={(text) => {
                setFormOpen(null);
                setTab("operator");
                setMessage(text);
                void load();
              }}
            />
          ) : null}
          {formOpen === "admin" ? (
            <OpsAdminInviteForm
              onCancel={() => setFormOpen(null)}
              onCreated={(text) => {
                setFormOpen(null);
                setTab("admin");
                setMessage(text);
                void load();
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <OpsOtpDialog
        open={revoke !== null}
        onOpenChange={(open) => (!open ? setRevoke(null) : undefined)}
        action="invite-revoke"
        title="Revoke this invite?"
        description="The setup link stops working immediately. You can send a new invite later."
        confirmLabel="Revoke invite"
        tone="danger"
        onConfirm={async ({ challengeId, otpCode }) => {
          if (!revoke) return;
          const input = { inviteId: revoke.row.id, challengeId, otpCode };
          if (revoke.kind === "operator") await revokeOpsInviteClient(input);
          else await revokeAdminInviteClient(input);
          setMessage(`Invite for ${revoke.row.inviteEmail} was revoked.`);
          await load();
        }}
      >
        {revoke ? (
          <KeyValueList
            items={[
              { label: "Invitee", value: `${revoke.row.inviteName} (${revoke.row.inviteEmail})`, wide: true },
              { label: "Type", value: revoke.kind === "operator" ? "Operator" : "Merchant admin" },
              { label: "Expires", value: formatOpsRelativeExpiry(revoke.row.expiresAt) },
            ]}
          />
        ) : null}
      </OpsOtpDialog>
    </ConsolePage>
  );
}
