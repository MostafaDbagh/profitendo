CREATE TABLE "platform_audit" (
  "id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "target_id" UUID NOT NULL,
  "target_type" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "before_active" BOOLEAN NOT NULL,
  "after_active" BOOLEAN NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_audit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_audit_created_at_id_idx" ON "platform_audit"("created_at", "id");
CREATE INDEX "platform_audit_target_id_created_at_idx" ON "platform_audit"("target_id", "created_at");
UPDATE "system_metadata" SET "value" = 'platform-v1' WHERE "key" = 'schema_version';
