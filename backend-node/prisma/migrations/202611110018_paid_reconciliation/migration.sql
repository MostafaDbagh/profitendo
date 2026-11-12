ALTER TABLE billing_checkouts ADD COLUMN paid_from timestamptz(3), ADD COLUMN paid_until timestamptz(3), ADD COLUMN paid_transaction text, ADD COLUMN reconciled_at timestamptz(3), ADD COLUMN access_hold boolean NOT NULL DEFAULT false, ADD COLUMN reconciliation_error text;
ALTER TABLE billing_checkouts ADD CONSTRAINT paid_period CHECK ((paid_from IS NULL AND paid_until IS NULL) OR (paid_from IS NOT NULL AND paid_until > paid_from));
UPDATE system_metadata SET value='paid-reconciliation-v1' WHERE key='schema_version';
