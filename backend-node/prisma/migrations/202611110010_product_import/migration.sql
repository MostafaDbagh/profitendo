CREATE TABLE product_imports (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL, currency text NOT NULL, payload text NOT NULL,
 status text NOT NULL DEFAULT 'PREVIEW' CHECK(status IN ('PREVIEW','COMPLETED','EXPIRED')),
 row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 500),
 created_at timestamptz(3) NOT NULL DEFAULT now(), expires_at timestamptz(3) NOT NULL,
 completed_at timestamptz(3), CHECK((status='COMPLETED')=(completed_at IS NOT NULL))
);
CREATE INDEX product_imports_business_id_actor_id_status_idx ON product_imports(business_id,actor_id,status);
CREATE INDEX product_imports_status_expires_at_idx ON product_imports(status,expires_at);
UPDATE system_metadata SET value='product-import-v1' WHERE key='schema_version';
