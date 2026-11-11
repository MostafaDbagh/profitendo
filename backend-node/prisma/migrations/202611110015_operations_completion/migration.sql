CREATE TABLE "adjustments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "source_id" UUID,
    "source_reference" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL,
    "location_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "client_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "currency_digits" INTEGER NOT NULL,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "actor_id" UUID NOT NULL,
    "actor_name" TEXT NOT NULL,
    "completed_by" UUID,
    "completed_name" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjustments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "adjustment_lines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "source_line_id" UUID,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "condition" TEXT NOT NULL DEFAULT 'RESTOCK',
    "expected" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "snapshot_movement_id" UUID,
    "delta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "adjustment_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "money_entries" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "source_id" UUID,
    "client_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cash_closes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "opening" DECIMAL(18,4) NOT NULL,
    "inflow" DECIMAL(18,4) NOT NULL,
    "outflow" DECIMAL(18,4) NOT NULL,
    "expected" DECIMAL(18,4) NOT NULL,
    "counted" DECIMAL(18,4) NOT NULL,
    "variance" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_closes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "migration_previews" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "client_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "actor_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_previews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "adjustments_business_id_location_id_kind_status_idx" ON "adjustments"("business_id", "location_id", "kind", "status");

CREATE INDEX "adjustments_business_id_source_id_status_idx" ON "adjustments"("business_id", "source_id", "status");

CREATE UNIQUE INDEX "adjustments_business_id_id_key" ON "adjustments"("business_id", "id");

CREATE UNIQUE INDEX "adjustments_business_id_client_key_key" ON "adjustments"("business_id", "client_key");

CREATE INDEX "adjustment_lines_business_id_source_line_id_idx" ON "adjustment_lines"("business_id", "source_line_id");

CREATE INDEX "money_entries_business_id_location_id_created_at_idx" ON "money_entries"("business_id", "location_id", "created_at");

CREATE INDEX "money_entries_business_id_source_id_kind_idx" ON "money_entries"("business_id", "source_id", "kind");

CREATE UNIQUE INDEX "money_entries_business_id_client_key_key" ON "money_entries"("business_id", "client_key");

CREATE UNIQUE INDEX "cash_closes_business_id_location_id_day_key" ON "cash_closes"("business_id", "location_id", "day");

CREATE UNIQUE INDEX "migration_previews_business_id_client_key_key" ON "migration_previews"("business_id", "client_key");

ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_business_id_location_id_fkey" FOREIGN KEY ("business_id", "location_id") REFERENCES "locations"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "adjustment_lines" ADD CONSTRAINT "adjustment_lines_business_id_document_id_fkey" FOREIGN KEY ("business_id", "document_id") REFERENCES "adjustments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "adjustment_lines" ADD CONSTRAINT "adjustment_lines_business_id_product_id_fkey" FOREIGN KEY ("business_id", "product_id") REFERENCES "products"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "money_entries" ADD CONSTRAINT "money_entries_business_id_location_id_fkey" FOREIGN KEY ("business_id", "location_id") REFERENCES "locations"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_closes" ADD CONSTRAINT "cash_closes_business_id_location_id_fkey" FOREIGN KEY ("business_id", "location_id") REFERENCES "locations"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "migration_previews" ADD CONSTRAINT "migration_previews_business_id_location_id_fkey" FOREIGN KEY ("business_id", "location_id") REFERENCES "locations"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE adjustments ADD CHECK(kind IN ('CUSTOMER_RETURN','SUPPLIER_RETURN','COUNT','DAMAGE','OPENING')), ADD CHECK(status IN ('DRAFT','COMPLETED','CANCELLED')), ADD CHECK(total>=0), ADD CHECK(currency_digits BETWEEN 0 AND 4), ADD CHECK(char_length(trim(reason))>=5), ADD CHECK((status='COMPLETED')=(completed_at IS NOT NULL)), ADD CHECK((kind IN ('CUSTOMER_RETURN','SUPPLIER_RETURN'))=(source_id IS NOT NULL));
ALTER TABLE adjustment_lines ADD CHECK(quantity>=0), ADD CHECK(expected>=0), ADD CHECK(amount>=0), ADD CHECK(unit_cost>=0), ADD CHECK(condition IN ('RESTOCK','DAMAGED'));
ALTER TABLE money_entries ADD CHECK(kind IN ('SUPPLIER_PAYMENT','SUPPLIER_REFUND','CUSTOMER_REFUND','EXPENSE','CASH_IN','CASH_OUT')), ADD CHECK(method IN ('CASH','CARD','TRANSFER')), ADD CHECK(amount>0), ADD CHECK(char_length(trim(reason))>=5), ADD CHECK(method='CASH' OR char_length(trim(reference))>0), ADD CHECK((kind IN ('SUPPLIER_PAYMENT','SUPPLIER_REFUND','CUSTOMER_REFUND'))=(source_id IS NOT NULL));
ALTER TABLE cash_closes ADD CHECK(opening>=0 AND counted>=0 AND inflow>=0 AND outflow>=0), ADD CHECK(expected=opening+inflow-outflow), ADD CHECK(variance=counted-expected), ADD CHECK(variance=0 OR char_length(trim(reason))>=5);
CREATE TRIGGER adjustment_immutable BEFORE UPDATE OR DELETE ON adjustments FOR EACH ROW EXECUTE FUNCTION protect_completed_sale();
CREATE FUNCTION protect_adjustment_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM adjustments WHERE id=NEW.document_id AND business_id=NEW.business_id AND status<>'DRAFT') THEN RAISE EXCEPTION 'Posted adjustments are immutable'; END IF;
 IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM adjustments WHERE id=OLD.document_id AND business_id=OLD.business_id AND status<>'DRAFT') THEN RAISE EXCEPTION 'Posted adjustments are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER adjustment_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON adjustment_lines FOR EACH ROW EXECUTE FUNCTION protect_adjustment_line();
CREATE TRIGGER money_entries_immutable BEFORE UPDATE OR DELETE ON money_entries FOR EACH ROW EXECUTE FUNCTION protect_stock_history();
CREATE TRIGGER cash_closes_immutable BEFORE UPDATE OR DELETE ON cash_closes FOR EACH ROW EXECUTE FUNCTION protect_stock_history();
UPDATE system_metadata SET value='operations-completion-v1' WHERE key='schema_version';
