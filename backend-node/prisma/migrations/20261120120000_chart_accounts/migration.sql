CREATE TABLE "chart_accounts" (
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL CHECK ("category" IN ('assets','liabilities','equity','revenue','cost_of_sales','expenses')),
  "nature" TEXT NOT NULL CHECK ("nature" IN ('debit','credit')),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("business_id","code")
);
