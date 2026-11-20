CREATE TABLE "partners" (
  "id" UUID PRIMARY KEY,
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "ownership" DECIMAL(7,4) NOT NULL CHECK ("ownership" BETWEEN 0 AND 100),
  "capital" DECIMAL(18,4) NOT NULL CHECK ("capital" >= 0),
  "currency" TEXT NOT NULL,
  "notes" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 0,
  UNIQUE ("business_id", "id")
);

CREATE TABLE "partner_transactions" (
  "id" UUID PRIMARY KEY,
  "business_id" UUID NOT NULL,
  "partner_id" UUID NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('ALLOCATION', 'CONTRIBUTION', 'WITHDRAWAL')),
  "amount" DECIMAL(18,4) NOT NULL CHECK ("amount" > 0),
  "day" TEXT NOT NULL,
  "notes" TEXT NOT NULL,
  "client_key" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("business_id", "partner_id") REFERENCES "partners"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE ("business_id", "partner_id", "client_key")
);

CREATE INDEX "partner_transactions_business_id_partner_id_day_id_idx"
  ON "partner_transactions" ("business_id", "partner_id", "day", "id");
