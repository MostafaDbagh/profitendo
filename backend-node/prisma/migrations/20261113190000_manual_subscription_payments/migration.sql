CREATE TABLE manual_subscription_payments (
 id UUID PRIMARY KEY, business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
 plan_id UUID NOT NULL REFERENCES billing_plans(id) ON DELETE RESTRICT, actor_id UUID NOT NULL,
 request_key UUID NOT NULL UNIQUE, method TEXT NOT NULL CHECK (method IN ('SHAM_CASH','PAYPAL')),
 reference TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), currency TEXT NOT NULL,
 paid_at TIMESTAMPTZ(3) NOT NULL, starts_at TIMESTAMPTZ(3) NOT NULL, ends_at TIMESTAMPTZ(3) NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(method,reference), CHECK(ends_at > starts_at)
);
CREATE INDEX manual_subscription_payments_business_id_ends_at_idx ON manual_subscription_payments(business_id,ends_at);
