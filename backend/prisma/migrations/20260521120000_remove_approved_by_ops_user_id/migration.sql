-- Drop the approvedByOpsUserId column from OpsAuditLog
-- This column was part of the legacy dual-approval system that has been removed.
-- OTP-based single-step approval is now used for all critical ops actions.

ALTER TABLE "OpsAuditLog" DROP COLUMN IF EXISTS "approvedByOpsUserId";
