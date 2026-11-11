CREATE TABLE billing_cancellations (
  id uuid PRIMARY KEY,
  checkout_id uuid NOT NULL UNIQUE REFERENCES billing_checkouts(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','CONFIRMED','REVIEW')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz(3) NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz(3),
  last_error text,
  confirmed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL)),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE INDEX billing_cancellations_status_next_attempt_at_idx ON billing_cancellations(status, next_attempt_at);
UPDATE system_metadata SET value = 'billing-cancellation-v1' WHERE key = 'schema_version';
