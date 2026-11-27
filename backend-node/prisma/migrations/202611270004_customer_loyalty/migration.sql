-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "loyalty_program" JSONB;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "customer_id" UUID;

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "progress" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_visits" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "step" INTEGER NOT NULL,
    "reversed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "loyalty_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_rewards" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "product_id" UUID,
    "redeemed_at" TIMESTAMP(3),
    "redeemed_by" UUID,
    "voided" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "loyalty_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_business_id_name_idx" ON "customers"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_business_id_phone_key" ON "customers"("business_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_business_id_id_key" ON "customers"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_visits_sale_id_key" ON "loyalty_visits"("sale_id");

-- CreateIndex
CREATE INDEX "loyalty_visits_business_id_customer_id_day_idx" ON "loyalty_visits"("business_id", "customer_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_rewards_visit_id_key" ON "loyalty_rewards"("visit_id");

-- CreateIndex
CREATE INDEX "loyalty_rewards_business_id_customer_id_idx" ON "loyalty_rewards"("business_id", "customer_id");

ALTER TABLE customers ADD FOREIGN KEY (business_id) REFERENCES businesses(id);
ALTER TABLE sales ADD FOREIGN KEY (business_id, customer_id) REFERENCES customers(business_id,id);
ALTER TABLE loyalty_visits ADD FOREIGN KEY (business_id,customer_id) REFERENCES customers(business_id,id),
  ADD FOREIGN KEY (business_id,sale_id) REFERENCES sales(business_id,id);
CREATE UNIQUE INDEX loyalty_active_day ON loyalty_visits(business_id,customer_id,day) WHERE NOT reversed;
ALTER TABLE loyalty_rewards ADD FOREIGN KEY (visit_id) REFERENCES loyalty_visits(id),
  ADD FOREIGN KEY (business_id,customer_id) REFERENCES customers(business_id,id);
ALTER TABLE sales ADD COLUMN loyalty_day TEXT;
