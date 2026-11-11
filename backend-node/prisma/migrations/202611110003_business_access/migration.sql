-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "base_currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "currency_locked_at" TIMESTAMPTZ(3),
ADD COLUMN     "date_format" TEXT NOT NULL DEFAULT 'dmy',
ADD COLUMN     "number_format" TEXT NOT NULL DEFAULT 'western',
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "permission_overrides" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "auth_audit" ADD COLUMN     "changes" JSONB,
ADD COLUMN     "target_id" TEXT;

-- CreateIndex
CREATE INDEX "auth_audit_business_id_created_at_idx" ON "auth_audit"("business_id", "created_at");


UPDATE "system_metadata" SET "value" = 'business-v1' WHERE "key" = 'schema_version';
