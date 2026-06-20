-- Fix enum drift before applying migrations
-- Run via: npx prisma db execute --schema prisma/schema.prisma --file scripts/fix-enum-drift.sql

-- OpsPermission: remove OPS_APPROVE (migrate to OPS_WRITE)
UPDATE "OpsUser" SET permissions = ARRAY_REMOVE(permissions, 'OPS_APPROVE');

-- OpsActionType: remove USER_KEY_ROTATED (delete those audit rows)
DELETE FROM "OpsAuditLog" WHERE "actionType" = 'USER_KEY_ROTATED';

-- OpsActionStatus: migrate old statuses to EXECUTED/FAILED
UPDATE "OpsAuditLog" SET "actionStatus" = 'EXECUTED' WHERE "actionStatus" IN ('PENDING_APPROVAL', 'APPROVED');
UPDATE "OpsAuditLog" SET "actionStatus" = 'FAILED' WHERE "actionStatus" = 'REJECTED';
