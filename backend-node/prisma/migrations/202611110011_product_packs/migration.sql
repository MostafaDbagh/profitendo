CREATE TABLE product_packs (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, product_id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 2 AND 80),
 base_quantity numeric(18,4) NOT NULL CHECK(base_quantity > 0),
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,product_id) REFERENCES products(business_id,id) ON DELETE RESTRICT,
 UNIQUE(business_id,product_id,name)
);
UPDATE system_metadata SET value='product-packs-v1' WHERE key='schema_version';
