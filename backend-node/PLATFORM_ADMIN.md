> Current policy (13 November 2026): authenticator MFA is optional for every role, including platform admins and billing. Only enrolled accounts must complete the sign-in challenge. Any role can disable MFA using their password and a valid code. This supersedes mandatory-enrollment wording in historical notes below.

# Platform administration (Service 4)

Implemented locally on 11 November 2026. The platform operator can inspect
customer account metadata and control access. Customer business records remain
protected by business membership and business permissions.

## Access boundary

Every platform operation revalidates the live account/session, SUPER_ADMIN role,
enrolled MFA secret and completed session MFA inside a serializable transaction.
A customer owner is not a platform administrator. A platform administrator does
not receive implicit business membership. Status writes require the exact app
origin, JSON, session CSRF, current revision and a 5–500 character reason.

All platform administrators are protected from status changes through this API,
including the signed-in administrator. No HTTP endpoint grants administrator
roles, changes customer passwords, removes MFA, impersonates customers, deletes
accounts or changes business ownership. The existing `admin:bootstrap` local
operator command creates the initial administrator and requires MFA enrollment
at first sign-in. No real administrator was created during implementation.

## Endpoints

- `GET /api/platform/overview`: business counts and customer account counts.
- `GET /api/platform/businesses`: minimal business metadata and member counts.
- `GET /api/platform/users`: name/email/platform role/verification/status only.
- `GET /api/platform/audit`: platform changes with actor, target, reason and time.
- `PATCH /api/platform/businesses/:id/status`.
- `PATCH /api/platform/users/:id/status`.

Status body: `{ revision, active, reason }`. Lists accept `page` (1-based),
`pageSize` (1–100), `q` (up to 100 characters) and `status` (all/active/inactive).
Audit accepts pagination only. Stale revisions return 409; strict schemas reject
mass assignment. Status no-ops do not create duplicate audit records. Responses
are no-store and never include password hashes, MFA secrets or session tokens.

Business suspension blocks all business API access through live authorization,
removes the business from accessible-business lists, and permanently revokes
pending invitations. It does not sign members out of unrelated businesses.
Reactivation restores existing membership access; it does not restore invitations.

Customer account disabling affects all businesses, increments security version,
revokes every session, consumes unused verification/reset tokens and revokes
pending invitations sent by that person. Reactivation requires a fresh sign-in;
old sessions and revoked links remain invalid. Account status uses securityVersion
as its revision, so concurrent security changes cause a stale-write conflict.

Status changes and before/after audit entries commit atomically. PlatformAudit
has its own table and API; internal support reasons never appear in customer
business activity. It retains actor/target identifiers without cascade deletion.
This is application-level audit history, not externally signed or tamper-proof
storage. No endpoint edits or deletes audit records.

## Frontend and verification

With REACT_APP_AUTH_API_URL set, authenticated Super Admin accounts get a
“Platform administration” link on /auth-v2 to /platform-v2. The workspace offers
an overview, searchable/filterable business and user lists, status-change
confirmation dialogs with impact text and required reason, and activity history.
Customers see an access-denied state. Existing auth, business and legacy screens
remain intact. Shared slate/emerald controls, labels, placeholders, dialogs and
Arabic/English layout conventions are reused.

- Migration 202611110004_platform_admin applied to isolated PostgreSQL 16.
- 10 platform integration tests cover role/MFA/live demotion, CSRF/origin/schema,
  minimal lists, suspension and invitation revocation, customer disable/session
  revocation, protected administrators, stale/concurrent writes and audit scope.
- 40 total database integration tests and 7 HTTP/configuration tests passed.
- Backend typecheck/build and frontend production build passed.
- `npm run test:browser:platform` passed against real local API/database: admin
  entry, customer denial, suspend/reactivate, stale edits, disable/reactivate,
  session revocation, audit, AR/EN 320/390/768/1440px and dialog focus restoration.
- Screenshots: ../tmp/platform-design/. Visual baseline: prior business workspace.
- Fixtures use unique test accounts and clean up their own records. No real
  customer data, external email or production deployment was involved.

Platform tests need the migrated dedicated TEST_DATABASE_URL ending in _test.
Browser tests additionally need the local API's APP_ORIGIN and encryption key.
Service 5 will handle subscriptions, billing and entitlements; manual business
suspension is not subscription cancellation and does not change payments.

## Paid approvals, subscription receipts and Contact Us — 2026-11-12

The platform navigation now includes Paid subscription approvals, Subscription
revenue, Subscriber billing list and Contact Us inbox. Existing plan creation,
publication, quotas, account/business suspension and audit controls are retained.

- Trials start immediately. An owner requests approval for a published paid plan.
  The administrator approves/rejects a pending request with a 5–500 character
  reason. The customer sees the decision and can resubmit after rejection.
- Checkout verifies approval inside its authorization transactions. Approval
  does not create a payment or extend entitlement. Paid entitlement requires
  both an approved business/plan pair and verified provider payment coverage.
  Rejection leaves an active trial intact. Existing checkouts receive migrated
  approval records so authorized customers do not unexpectedly lose access.
- Decisions require completed admin MFA, CSRF and the current revision. Billing
  audit records retain decisions and reasons; customer access is owner-scoped.
- Revenue reports show gross verified receipts for the current configured
  payment-provider account, grouped by currency and filtered by UTC month.
  Sandbox is labeled explicitly. This is not net revenue: refunds and provider
  fees are not deducted. With no provider configured, the report explains why
  no revenue is shown. The subscriber list shows trial/paid state, plan and period
  end without exposing the customer's stock, sales or purchasing records.
- `/contact` provides public and signed-in support. Signed-in requests may be
  linked only to a business the requester belongs to. Only the requester and
  platform administrators can read/reply; another owner/staff member cannot
  read the conversation merely by sharing a business.
- Public requests receive a 256-bit private tracking token. Only its hash is
  stored; the browser removes the fragment from the address bar and shows a
  private link to save. Public read/reply requires this token in a header.
  Emails are contact details, not proof of access. No automatic account linking
  occurs. There is no outbound email notification until SMTP work is enabled.
- Admins can reply and set New / In progress / Resolved. Customer replies reopen
  requests. The inbox includes name/email/business/category/date/status and
  conversation history. Status changes use optimistic revision checks; replies
  and status changes are audited. Form lengths, rate limits, strict request
  schemas and a maximum 200 messages per conversation bound public abuse.

Migration: `202611120001_subscriber_support`. Apply with `npm run db:migrate`
before starting the updated API. Local test and mock-preview databases were
migrated; no production database or deployment was changed.

Validation: `tests/admin-services.test.ts`, existing PayPal/billing/platform
regressions and `npm run test:browser:admin-services`. Browser script starts a
temporary API on 4100 and expects the mock frontend on 3100; stop the preview API
first. Fixtures are isolated and removed afterwards. Screenshots are in ignored
`tmp/admin-services-design` and preserve the existing AR/EN slate/emerald design.

### Checklist completion — 2026-11-12

Subscriber billing now separates owner/contact, subscription/access status,
period end, provider-reported next renewal, payment review/received/pending
status and the last receipt. Suspended businesses are marked independently of
their billing state. Renewal is never inferred from trial/entitlement expiry:
`next_billing_at` is refreshed from verified provider snapshots/reconciliation
and hidden for inactive/cancelled or held contracts. Existing dates remain
unknown until refreshed. Migration: `202611120002_billing_renewal`.

Super Admin may edit an unpublished draft only while no subscription, checkout
or approval request references it. Updates require a matching revision and
record old/new terms. Published or customer-linked plans require a new plan so
existing customer terms cannot silently change. The plan table includes trial
duration; billing history now shows customer business, decision reason or
changed fields, actor and timestamp.
