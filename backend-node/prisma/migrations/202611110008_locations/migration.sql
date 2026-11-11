CREATE UNIQUE INDEX memberships_business_id_id_key ON memberships(business_id,id);
CREATE TABLE locations (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,29}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  kind text NOT NULL CHECK (kind IN ('WAREHOUSE','SHOP')),
  address text NOT NULL DEFAULT '' CHECK (char_length(address) <= 500),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  archived_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (business_id,code), UNIQUE (business_id,id)
);
CREATE INDEX locations_business_id_archived_at_kind_idx ON locations(business_id,archived_at,kind);
CREATE TABLE location_assignments (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  location_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id,location_id) REFERENCES locations(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,membership_id) REFERENCES memberships(business_id,id) ON DELETE CASCADE,
  UNIQUE (location_id,membership_id)
);
CREATE INDEX location_assignments_business_id_membership_id_idx ON location_assignments(business_id,membership_id);
UPDATE system_metadata SET value = 'locations-v1' WHERE key = 'schema_version';
