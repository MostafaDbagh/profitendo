ALTER TABLE product_packs ADD COLUMN retired_at timestamptz(3);
ALTER TABLE products DROP CONSTRAINT products_unit_check;
ALTER TABLE products ADD CONSTRAINT products_unit_check CHECK(unit ~ '^[A-Z][A-Z0-9_]{1,31}$');
CREATE TABLE catalogue_references (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('CATEGORY','UNIT')), code text NOT NULL, name text NOT NULL,
 active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 0,
 UNIQUE(business_id,kind,code)
);
CREATE TABLE product_images (
 product_id uuid PRIMARY KEY, business_id uuid NOT NULL, data text NOT NULL CHECK(length(data)<=400000),
 FOREIGN KEY(business_id,product_id) REFERENCES products(business_id,id) ON DELETE CASCADE
);
UPDATE system_metadata SET value='catalogue-complete-v1' WHERE key='schema_version';
