-- AddColumn: isBanned, bannedAt, bannedReason to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isBanned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bannedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bannedReason" TEXT;

-- CreateIndex on isBanned
CREATE INDEX IF NOT EXISTS "User_isBanned_idx" ON "User"("isBanned");

-- DropColumn: adminMfaEnabled, adminMfaSecretEncrypted from User (replaced by email OTP)
ALTER TABLE "User" DROP COLUMN IF EXISTS "adminMfaEnabled";
ALTER TABLE "User" DROP COLUMN IF EXISTS "adminMfaSecretEncrypted";

-- CreateTable: UserAdminNote
CREATE TABLE IF NOT EXISTS "UserAdminNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAdminNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on UserAdminNote.userId
CREATE INDEX IF NOT EXISTS "UserAdminNote_userId_idx" ON "UserAdminNote"("userId");

-- AddForeignKey: UserAdminNote → User
ALTER TABLE "UserAdminNote" ADD CONSTRAINT "UserAdminNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
