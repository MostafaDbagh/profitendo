CREATE TABLE products (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
 sku text NOT NULL CHECK (sku ~ '^[A-Z0-9][A-Z0-9_-]{1,59}$'),
 name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 160),
 category text NOT NULL DEFAULT '', subcategory text NOT NULL DEFAULT '', brand text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '',
 unit text NOT NULL CHECK (unit IN ('PIECE','BOX','CARTON','KG','LITRE','METRE')),
 purchase_price numeric(18,4) NOT NULL CHECK(purchase_price >= 0), selling_price numeric(18,4) NOT NULL CHECK(selling_price >= 0), minimum_stock numeric(18,4) NOT NULL DEFAULT 0 CHECK(minimum_stock >= 0),
 active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 0,
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
 UNIQUE(business_id,sku), UNIQUE(business_id,id)
);
CREATE INDEX products_business_id_active_name_idx ON products(business_id,active,name);
CREATE TABLE product_barcodes (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, product_id uuid NOT NULL,
 value text NOT NULL CHECK(value ~ '^[!-~]{1,128}$'),
 FOREIGN KEY(business_id,product_id) REFERENCES products(business_id,id) ON DELETE RESTRICT,
 UNIQUE(business_id,value)
);
CREATE INDEX product_barcodes_business_id_product_id_idx ON product_barcodes(business_id,product_id);
UPDATE system_metadata SET value='catalogue-v1' WHERE key='schema_version';
