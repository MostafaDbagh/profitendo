CREATE TABLE "billing_plans" (
  "id" UUID NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "name_ar" TEXT NOT NULL,
  "price_minor" INTEGER, "currency" TEXT NOT NULL DEFAULT 'USD', "interval" TEXT NOT NULL DEFAULT 'MONTH',
  "trial_days" INTEGER NOT NULL DEFAULT 0, "max_members" INTEGER NOT NULL, "max_warehouses" INTEGER NOT NULL, "max_shops" INTEGER NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT false, "revision" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_plan_limits" CHECK (trial_days BETWEEN 0 AND 60 AND max_members >= 1 AND max_warehouses >= 0 AND max_shops >= 0 AND (price_minor IS NULL OR price_minor > 0))
);
CREATE UNIQUE INDEX "billing_plans_code_key" ON "billing_plans"("code");
CREATE TABLE "business_subscriptions" (
  "id" UUID NOT NULL, "business_id" UUID NOT NULL, "plan_id" UUID NOT NULL, "status" TEXT NOT NULL DEFAULT 'TRIAL',
  "trial_started_at" TIMESTAMPTZ(3) NOT NULL, "trial_ends_at" TIMESTAMPTZ(3) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "trial_dates" CHECK (trial_ends_at > trial_started_at),
  CONSTRAINT "trial_status" CHECK (status = 'TRIAL')
);
CREATE UNIQUE INDEX "business_subscriptions_business_id_key" ON "business_subscriptions"("business_id");
CREATE TABLE "billing_audit" (
  "id" UUID NOT NULL, "actor_id" UUID NOT NULL, "business_id" UUID, "plan_id" UUID NOT NULL,
  "action" TEXT NOT NULL, "changes" JSONB NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_audit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "billing_audit_created_at_id_idx" ON "billing_audit"("created_at", "id");
-- Provisional free evaluation offer. No paid price or provider plan is assumed.
INSERT INTO "billing_plans" (id, code, name, name_ar, trial_days, max_members, max_warehouses, max_shops, published)
VALUES ('8ac8ae27-f871-47f2-8d70-e38b0aed295c', 'pilot-trial-v1', 'Business trial', 'تجربة النشاط التجاري', 14, 10, 2, 3, true);
UPDATE "system_metadata" SET "value" = 'billing-foundation-v1' WHERE "key" = 'schema_version';
