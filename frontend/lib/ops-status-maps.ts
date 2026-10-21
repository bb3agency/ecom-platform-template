import type { StatusTone } from "@/components/ui/console";
import type { OpsInviteListItem, OpsLoadShedStatus } from "@/lib/ops-client-api";

type LoadShedMode = OpsLoadShedStatus["mode"];

export function loadShedTone(mode: LoadShedMode): StatusTone {
  switch (mode) {
    case "normal":
      return "success";
    case "reduced":
      return "warning";
    case "emergency":
      return "danger";
    case "maintenance":
      // Planned and persistent — distinct from the unplanned "danger" state.
      return "info";
    default:
      return "neutral";
  }
}

export const LOAD_SHED_MODE_LABELS: Record<LoadShedMode, string> = {
  normal: "Normal",
  reduced: "Reduced",
  emergency: "Emergency",
  maintenance: "Maintenance",
};

/** What shoppers and staff experience in each mode. */
export const LOAD_SHED_MODE_DESCRIPTIONS: Record<LoadShedMode, string> = {
  normal: "Everything is open: storefront, checkout, admin and ops.",
  reduced: "Heavy admin reports and analytics pause. Browsing and checkout stay open.",
  emergency: "Checkout, cart changes and admin edits are blocked. Use under severe load or a provider outage.",
  maintenance:
    "Planned downtime. Shoppers get a 2-minute warning, then the storefront shows a maintenance page until you switch back. Ops stays reachable.",
};

export function loadShedLabel(status: Pick<OpsLoadShedStatus, "mode" | "phase">): string {
  if (status.mode === "maintenance") {
    return status.phase === "pending" ? "Maintenance starting" : "Maintenance";
  }
  return LOAD_SHED_MODE_LABELS[status.mode];
}

export function inviteStatusTone(status: OpsInviteListItem["status"]): StatusTone {
  switch (status) {
    case "CONSUMED":
      return "success";
    case "EMAIL_SENT":
    case "CREATED":
      return "info";
    default:
      return "neutral";
  }
}

export const INVITE_STATUS_LABELS: Record<OpsInviteListItem["status"], string> = {
  CREATED: "Created",
  EMAIL_SENT: "Waiting",
  CONSUMED: "Accepted",
  CANCELLED: "Revoked",
  EXPIRED_CLEANED: "Expired",
};

export function auditStatusTone(status: "EXECUTED" | "FAILED"): StatusTone {
  return status === "EXECUTED" ? "success" : "danger";
}

/** Plain-language names for audit action types. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOAD_SHED_CHANGE: "Traffic mode changed",
  ENV_READ: "Configuration viewed",
  ENV_UPDATE: "Configuration saved",
  CONTAINER_RESTART: "Restart scheduled",
  DB_BACKUP: "Database backup",
  DB_RESTORE: "Database restore",
  FEATURE_FLAG_TOGGLE: "Feature flag changed",
  INVITE_CREATED: "Invite sent",
  INVITE_CONSUMED: "Invite accepted",
  INVITE_EXPIRED_CLEANED: "Expired invites cleared",
  INVITE_REVOKED: "Invite revoked",
  OTP_CHALLENGE_REQUESTED: "Verification code sent",
  OTP_CHALLENGE_VERIFIED: "Verification code accepted",
  OTP_CHALLENGE_FAILED: "Verification code rejected",
  USER_DEACTIVATED: "Account deactivated",
  OPS_USER_LOGGED_IN: "Signed in",
  OPS_USER_LOGGED_OUT: "Signed out",
};

export function auditActionLabel(actionType: string | undefined | null): string {
  if (!actionType) return "Request";
  return AUDIT_ACTION_LABELS[actionType] ?? actionType;
}
