
CREATE TABLE suppliers (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
 code text NOT NULL, name text NOT NULL, contact text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
 email text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 0,
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
 UNIQUE(business_id,id), UNIQUE(business_id,code)
);
CREATE INDEX suppliers_business_id_active_name_idx ON suppliers(business_id,active,name);
CREATE TABLE stock_balances (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, location_id uuid NOT NULL, product_id uuid NOT NULL,
 on_hand numeric(18,4) NOT NULL DEFAULT 0, reserved numeric(18,4) NOT NULL DEFAULT 0,
 updated_at timestamptz(3) NOT NULL DEFAULT now(),
 CHECK(on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand),
 FOREIGN KEY(business_id,location_id) REFERENCES locations(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,product_id) REFERENCES products(business_id,id) ON DELETE RESTRICT,
 UNIQUE(business_id,location_id,product_id)
);
CREATE TABLE stock_movements (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, location_id uuid NOT NULL, product_id uuid NOT NULL,
 type text NOT NULL, quantity numeric(18,4) NOT NULL CHECK(quantity <> 0),
 source_id uuid NOT NULL, source_line_id uuid NOT NULL, reference text NOT NULL, actor_id uuid NOT NULL,
 notes text NOT NULL DEFAULT '', created_at timestamptz(3) NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,location_id) REFERENCES locations(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,product_id) REFERENCES products(business_id,id) ON DELETE RESTRICT,
 UNIQUE(business_id,type,source_line_id)
);
CREATE INDEX stock_movements_business_id_location_id_created_at_idx ON stock_movements(business_id,location_id,created_at);
CREATE FUNCTION protect_stock_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Stock movement history is append only'; END; $$;
CREATE TRIGGER stock_history_immutable BEFORE UPDATE OR DELETE ON stock_movements
 FOR EACH ROW EXECUTE FUNCTION protect_stock_history();
CREATE TABLE purchase_documents (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, location_id uuid NOT NULL, supplier_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('ORDER','RECEIPT')), reference text NOT NULL,
 client_key uuid NOT NULL, request_hash text NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT', revision integer NOT NULL DEFAULT 0,
 order_id uuid, supplier_name text NOT NULL, location_name text NOT NULL, currency text NOT NULL,
 document_date date NOT NULL, supplier_reference text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 actor_id uuid NOT NULL, actor_name text NOT NULL, completed_by uuid, completed_name text, completed_at timestamptz(3),
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
 CHECK((kind='ORDER' AND status IN ('DRAFT','OPEN','PARTIAL','RECEIVED','CANCELLED') AND order_id IS NULL)
    OR (kind='RECEIPT' AND status IN ('DRAFT','PENDING','COMPLETED','CANCELLED'))),
 CHECK((status='COMPLETED') = (completed_at IS NOT NULL)),
 FOREIGN KEY(business_id,location_id) REFERENCES locations(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,supplier_id) REFERENCES suppliers(business_id,id) ON DELETE RESTRICT,
 UNIQUE(business_id,id), UNIQUE(business_id,client_key), UNIQUE(business_id,reference),
 FOREIGN KEY(business_id,order_id) REFERENCES purchase_documents(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX purchase_documents_business_id_location_id_kind_status_idx ON purchase_documents(business_id,location_id,kind,status);
CREATE TABLE purchase_lines (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, document_id uuid NOT NULL, product_id uuid NOT NULL,
 sku text NOT NULL, name text NOT NULL, unit text NOT NULL, barcodes text[] NOT NULL,
 pack_name text, factor numeric(18,4) NOT NULL CHECK(factor>0),
 quantity numeric(18,4) NOT NULL CHECK(quantity>0), base_quantity numeric(18,4) NOT NULL CHECK(base_quantity>0),
 received_quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK(received_quantity>=0 AND received_quantity<=base_quantity),
 unit_cost numeric(18,4) NOT NULL CHECK(unit_cost>=0),
 FOREIGN KEY(business_id,document_id) REFERENCES purchase_documents(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,product_id) REFERENCES products(business_id,id) ON DELETE RESTRICT,
 UNIQUE(business_id,document_id,product_id)
);
UPDATE system_metadata SET value='operations-v1' WHERE key='schema_version';
