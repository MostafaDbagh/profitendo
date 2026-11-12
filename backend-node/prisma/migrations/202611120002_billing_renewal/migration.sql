-- Only a provider-verified next billing time is a renewal date. Do not infer it
-- from paid entitlement or the trial end. Existing rows refresh on reconciliation.
ALTER TABLE billing_checkouts ADD COLUMN next_billing_at TIMESTAMPTZ(3);
