
ALTER TABLE product_packs ADD CONSTRAINT product_packs_business_product_id_key UNIQUE(business_id,product_id,id);
CREATE TABLE sales (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, location_id uuid NOT NULL, reference text NOT NULL,
 client_key uuid NOT NULL, request_hash text NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','COMPLETED','CANCELLED')),
 revision integer NOT NULL DEFAULT 0, business_name text NOT NULL, location_name text NOT NULL, location_code text NOT NULL,
 timezone text NOT NULL, currency text NOT NULL, currency_digits integer NOT NULL CHECK(currency_digits BETWEEN 0 AND 4),
 customer_name text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 subtotal numeric(18,4) NOT NULL CHECK(subtotal>=0), discount numeric(18,4) NOT NULL CHECK(discount>=0),
 total numeric(18,4) NOT NULL CHECK(total>=0), CHECK(total=subtotal-discount),
 actor_id uuid NOT NULL, actor_name text NOT NULL, priced_by uuid NOT NULL, priced_name text NOT NULL,
 expires_at timestamptz(3) NOT NULL, checkout_key uuid, checkout_hash text,
 completed_by uuid, completed_name text, completed_at timestamptz(3),
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
 CHECK((status='COMPLETED')=(completed_at IS NOT NULL)),
 CHECK((status='COMPLETED')=(checkout_key IS NOT NULL AND checkout_hash IS NOT NULL AND completed_by IS NOT NULL)),
 FOREIGN KEY(business_id,location_id) REFERENCES locations(business_id,id) ON DELETE RESTRICT,
 UNIQUE(business_id,id), UNIQUE(business_id,client_key), UNIQUE(business_id,checkout_key), UNIQUE(business_id,reference)
);
CREATE INDEX sales_business_id_location_id_status_created_at_idx ON sales(business_id,location_id,status,created_at);
CREATE TABLE sale_lines (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, sale_id uuid NOT NULL, product_id uuid NOT NULL, pack_id uuid, unit_key text NOT NULL,
 sku text NOT NULL, name text NOT NULL, unit text NOT NULL, barcodes text[] NOT NULL, pack_name text,
 factor numeric(18,4) NOT NULL CHECK(factor>0), quantity numeric(18,4) NOT NULL CHECK(quantity>0), base_quantity numeric(18,4) NOT NULL CHECK(base_quantity>0),
 unit_price numeric(18,4) NOT NULL CHECK(unit_price>=0), unit_cost numeric(18,4) NOT NULL CHECK(unit_cost>=0),
 gross numeric(18,4) NOT NULL CHECK(gross>=0), discount numeric(18,4) NOT NULL CHECK(discount>=0),
 discount_reason text NOT NULL DEFAULT '', total numeric(18,4) NOT NULL CHECK(total>=0),
 CHECK(total=gross-discount), CHECK(discount=0 OR char_length(trim(discount_reason))>=5),
 CHECK((pack_id IS NULL AND unit_key='BASE') OR (pack_id IS NOT NULL AND unit_key=pack_id::text)),
 FOREIGN KEY(business_id,sale_id) REFERENCES sales(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,product_id) REFERENCES products(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,product_id,pack_id) REFERENCES product_packs(business_id,product_id,id) ON DELETE RESTRICT,
 UNIQUE(business_id,sale_id,product_id,unit_key)
);
CREATE TABLE sale_payments (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, sale_id uuid NOT NULL, method text NOT NULL CHECK(method IN ('CASH','CARD','TRANSFER')),
 amount numeric(18,4) NOT NULL CHECK(amount>=0), received numeric(18,4) NOT NULL CHECK(received>=amount),
 change numeric(18,4) NOT NULL CHECK(change>=0 AND change=received-amount),
 reference text NOT NULL DEFAULT '', actor_id uuid NOT NULL, actor_name text NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 CHECK(method='CASH' OR (change=0 AND char_length(trim(reference))>0)),
 FOREIGN KEY(business_id,sale_id) REFERENCES sales(business_id,id) ON DELETE RESTRICT,
 UNIQUE(business_id,sale_id)
);
CREATE FUNCTION protect_completed_sale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.status='COMPLETED' THEN RAISE EXCEPTION 'Completed sales are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $$;
CREATE TRIGGER completed_sale_immutable BEFORE UPDATE OR DELETE ON sales FOR EACH ROW EXECUTE FUNCTION protect_completed_sale();
CREATE FUNCTION protect_completed_sale_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; tenant_id uuid;
BEGIN
 IF TG_OP='DELETE' THEN parent_id:=OLD.sale_id; tenant_id:=OLD.business_id; ELSE parent_id:=NEW.sale_id; tenant_id:=NEW.business_id; END IF;
 IF EXISTS(SELECT 1 FROM sales WHERE id=parent_id AND business_id=tenant_id AND status='COMPLETED')
 OR (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM sales WHERE id=OLD.sale_id AND business_id=OLD.business_id AND status='COMPLETED'))
 THEN RAISE EXCEPTION 'Completed sale lines are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $$;
CREATE TRIGGER completed_sale_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON sale_lines FOR EACH ROW EXECUTE FUNCTION protect_completed_sale_line();
CREATE TRIGGER sale_payments_immutable BEFORE UPDATE OR DELETE ON sale_payments FOR EACH ROW EXECUTE FUNCTION protect_stock_history();
UPDATE system_metadata SET value='sales-v1' WHERE key='schema_version';
