CREATE TABLE "paid_approvals" (
 "id" UUID PRIMARY KEY, "business_id" UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 "plan_id" UUID NOT NULL REFERENCES billing_plans(id), "requested_by" UUID NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 "reason" TEXT NOT NULL DEFAULT '', "revision" INTEGER NOT NULL DEFAULT 0,
 "decided_by" UUID, "decided_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX paid_approvals_business_id_plan_id_key ON paid_approvals(business_id,plan_id);
CREATE INDEX paid_approvals_status_created_at_idx ON paid_approvals(status,created_at);
-- Existing payment contracts retain their previously authorized access.
INSERT INTO paid_approvals(id,business_id,plan_id,requested_by,status,reason,decided_at)
 SELECT c.id,c.business_id,c.plan_id,m.user_id,'APPROVED','Existing checkout migrated',CURRENT_TIMESTAMP
 FROM billing_checkouts c JOIN LATERAL (SELECT user_id FROM memberships WHERE business_id=c.business_id AND role='OWNER' ORDER BY id LIMIT 1) m ON true;
CREATE TABLE support_tickets (
 id UUID PRIMARY KEY, user_id UUID, business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
 guest_token_hash TEXT, name TEXT NOT NULL, email TEXT NOT NULL, subject TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('SUBSCRIPTION','BILLING','TECHNICAL','GENERAL')),
 status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','IN_PROGRESS','RESOLVED')),
 revision INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX support_tickets_user_id_updated_at_idx ON support_tickets(user_id,updated_at);
CREATE INDEX support_tickets_status_updated_at_idx ON support_tickets(status,updated_at);
CREATE TABLE support_messages (
 id UUID PRIMARY KEY, ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
 author_id UUID, from_admin BOOLEAN NOT NULL DEFAULT false, body TEXT NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX support_messages_ticket_id_created_at_idx ON support_messages(ticket_id,created_at);
