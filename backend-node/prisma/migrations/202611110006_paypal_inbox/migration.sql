CREATE TABLE "billing_checkouts" (
 "id" UUID NOT NULL, "business_id" UUID NOT NULL, "plan_id" UUID NOT NULL, "scope" TEXT NOT NULL,
 "provider_plan_id" TEXT NOT NULL, "provider_subscription_id" TEXT, "provider_status" TEXT,
 "provider_updated_at" TIMESTAMPTZ(3), "revision" INTEGER NOT NULL DEFAULT 0,
 "lease_token" UUID, "lease_until" TIMESTAMPTZ(3), "first_requested_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "billing_checkouts_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "billing_checkouts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "billing_checkouts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "billing_checkouts_business_id_key" ON "billing_checkouts"("business_id");
CREATE UNIQUE INDEX "billing_checkouts_scope_provider_subscription_id_key" ON "billing_checkouts"("scope","provider_subscription_id");
CREATE TABLE "billing_webhooks" (
 "id" UUID NOT NULL, "scope" TEXT NOT NULL, "event_id" TEXT NOT NULL, "event_type" TEXT NOT NULL,
 "payload_hash" TEXT NOT NULL, "payload" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
 "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lease_token" UUID, "lease_until" TIMESTAMPTZ(3), "last_error" TEXT,
 "processed_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "billing_webhooks_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "billing_webhook_status" CHECK (status IN ('PENDING','PROCESSING','PROCESSED','IGNORED','REVIEW'))
);
CREATE UNIQUE INDEX "billing_webhooks_scope_event_id_key" ON "billing_webhooks"("scope","event_id");
CREATE INDEX "billing_webhooks_scope_status_next_attempt_at_idx" ON "billing_webhooks"("scope","status","next_attempt_at");
CREATE TABLE "billing_receipts" (
 "id" UUID NOT NULL, "checkout_id" UUID NOT NULL, "scope" TEXT NOT NULL, "transaction_id" TEXT NOT NULL,
 "event_id" TEXT NOT NULL, "amount_minor" INTEGER NOT NULL, "currency" TEXT NOT NULL, "paid_at" TIMESTAMPTZ(3) NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "billing_receipts_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "billing_receipts_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "billing_checkouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "billing_receipt_amount" CHECK (amount_minor > 0)
);
CREATE UNIQUE INDEX "billing_receipts_scope_transaction_id_key" ON "billing_receipts"("scope","transaction_id");
CREATE INDEX "billing_receipts_checkout_id_paid_at_idx" ON "billing_receipts"("checkout_id","paid_at");
UPDATE "system_metadata" SET "value" = 'paypal-inbox-v1' WHERE "key" = 'schema_version';
