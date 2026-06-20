-- Durable load-shed / maintenance state. One-row table keyed by `singletonKey`.
-- Postgres is the source of truth; Redis is the fast read cache. On Redis loss
-- or process boot, callers reload the row to repopulate the cache so the
-- selected mode (including `maintenance` + phase) survives infrastructure resets.

CREATE TABLE "MaintenanceState" (
    "id"             TEXT NOT NULL,
    "singletonKey"   TEXT NOT NULL DEFAULT 'singleton',
    "mode"           TEXT NOT NULL DEFAULT 'normal',
    "phase"          TEXT,
    "pendingUntil"   TIMESTAMP(3),
    "activatedAt"    TIMESTAMP(3),
    "reason"         TEXT,
    "setByOpsUserId" TEXT,
    "setAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaintenanceState_singletonKey_key" ON "MaintenanceState"("singletonKey");
