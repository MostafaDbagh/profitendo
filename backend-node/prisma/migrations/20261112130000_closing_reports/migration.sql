CREATE TABLE report_preferences (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 report_types text[] NOT NULL DEFAULT ARRAY['SALES','GROSS_PROFIT','NET_PROFIT','EXPENSES','RETURNS','CASH'],
 language text NOT NULL DEFAULT 'en' CHECK(language IN ('en','ar')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), updated_at timestamptz(3) NOT NULL DEFAULT now(),
 UNIQUE(business_id,user_id),
 CHECK(cardinality(report_types) BETWEEN 1 AND 6 AND report_types <@ ARRAY['SALES','GROSS_PROFIT','NET_PROFIT','EXPENSES','RETURNS','CASH']::text[])
);
CREATE TABLE report_deliveries (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
 request_key text NOT NULL, request_hash text NOT NULL, automatic boolean NOT NULL DEFAULT false,
 close_id uuid, location_id uuid, from_day text NOT NULL, to_day text NOT NULL,
 report_types text[] NOT NULL, language text NOT NULL CHECK(language IN ('en','ar')),
 snapshot text NOT NULL DEFAULT '', attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz(3) NOT NULL DEFAULT now(), cancelled_at timestamptz(3),failure_code text,
 created_at timestamptz(3) NOT NULL DEFAULT now(), UNIQUE(business_id,user_id,request_key),
 CHECK(cardinality(report_types) BETWEEN 1 AND 6 AND report_types <@ ARRAY['SALES','GROSS_PROFIT','NET_PROFIT','EXPENSES','RETURNS','CASH']::text[])
);
CREATE INDEX report_deliveries_user_id_business_id_created_at_idx ON report_deliveries(user_id,business_id,created_at);
CREATE INDEX report_deliveries_available_at_idx ON report_deliveries(available_at);
ALTER TABLE auth_mail ADD COLUMN report_id uuid UNIQUE REFERENCES report_deliveries(id) ON DELETE CASCADE;
