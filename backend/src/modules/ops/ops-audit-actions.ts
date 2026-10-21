/**
 * Every `OpsActionType` enum value (prisma/schema.prisma). Used as the allowed
 * `actionType` filter on GET /api/v1/ops/audit/logs so an unknown value is a
 * 400 validation error instead of a Prisma 500. Keep in sync with the enum.
 */
export const OPS_AUDIT_ACTION_TYPES = [
  'LOAD_SHED_CHANGE',
  'ENV_READ',
  'ENV_UPDATE',
  'CONTAINER_RESTART',
  'DB_BACKUP',
  'DB_RESTORE',
  'FEATURE_FLAG_TOGGLE',
  'INVITE_CREATED',
  'INVITE_CONSUMED',
  'INVITE_EXPIRED_CLEANED',
  'INVITE_REVOKED',
  'OTP_CHALLENGE_REQUESTED',
  'OTP_CHALLENGE_VERIFIED',
  'OTP_CHALLENGE_FAILED',
  'USER_DEACTIVATED',
  'OPS_USER_LOGGED_IN',
  'OPS_USER_LOGGED_OUT'
] as const;

export type OpsAuditActionType = (typeof OPS_AUDIT_ACTION_TYPES)[number];
