# Billing — local lifecycle implementation

Updated 12 November 2026. Paid checkout is OFF by default and has not been tested
against an actual PayPal sandbox account. No customer has been charged.

## Current behavior

- Trials, usage limits, plan drafts, durable webhook processing, cancellation and
  owner receipt history remain supported. New server-side reconciliation queries
  the bound subscription, verified plan terms and provider transaction history.
- A paid grant requires a unique completed payment matching plan currency/amount
  and provider last-payment time, zero outstanding balance, zero failed payments,
  ACTIVE state and a bounded provider next-billing date. No arrival-time arithmetic
  or browser-supplied subscription ID grants access. The same transaction cannot
  extend its previously verified period. Missing webhook receipts are repaired.
- Verified paid terms feed the existing server-side staff/location/operational
  entitlement checks. Cancellation stops renewal but retains the verified period.
  Failed renewal does not add grace days. Access expires at the paid-through date;
  no scheduled job is needed to enforce expiration. Billing/history stay reachable.
- Refunds, partial refunds and reversals place access on hold for operator review.
  A hold is deliberately not cleared by an unrelated replay. Automated refunds,
  discretionary grace, upgrades/downgrades, re-subscription after cancellation and
  automatic legacy subscription migration are not supported. These need an agreed
  commercial policy and sandbox evidence before broad paid rollout.
- The worker rotates through bound checkouts, stores reconciliation errors and
  uses revision checks to reject concurrent stale updates. Provider outages never
  create new access. Review mismatches fail closed; inspect billing_checkouts and
  existing provider-event REVIEW endpoints with authorized operational access.

## Enabling after external verification

Configure dedicated B2B provider credentials and immutable local priced plans.
`B2B_PAYPAL_PLAN_BINDINGS` is a server-only JSON mapping from local plan codes to
provider plan IDs. Paid publication requires `B2B_CHECKOUT_ENABLED=true`,
`B2B_PRICING_APPROVED=true` and `B2B_SANDBOX_VERIFIED=true`, plus a mapped plan.
These flags record operator decisions; they do not perform or certify those tests.
Startup rejects enabled checkout without provider configuration. Defaults remain off.

Owners POST `/api/billing/businesses/:id/checkout` with `{planId,confirm:true}`;
the API verifies ownership, live business authorization and provider terms, and
returns an HTTPS PayPal approval URL. The UI shows recurring price, interval and
limits. POST `/reconcile` with `{}` refreshes status at most once a minute per
business. The background worker provides the durable renewal path.

Verified with local fake-provider and database tests, not real provider credentials.
Official contracts: https://developer.paypal.com/api/subscriptions/v1/schema.json

## Historical implementation and verification notes

# B2B billing — Service 5 progress

Implemented locally on 11 November 2026. Service 5 is **in progress**. This
foundation delivers configurable plan terms, one-time business trials and staff
entitlement enforcement. Part 2 adds provider transport, internal checkout intents,
a durable verified webhook inbox and owner receipt history; see PAYPAL.md.
Paid checkout and paid-access grants remain disabled.

## Commercial decision

The user has not decided pricing. A provisional, configurable evaluation offer
is seeded by migration: 14 days, 10 team places including the owner, 2 warehouse
allowances and 3 shop allowances. There is no paid price or PayPal plan binding.
No existing business is automatically enrolled; an authenticated owner explicitly
starts the trial. No credit card or provider call is involved.

Super Admin can create trial offers or paid-plan drafts. Terms are immutable:
create a new uniquely coded plan to change limits, prices or duration. Publication
only affects new trial starts; existing subscriptions keep their original plan.
Paid drafts cannot be published. No API can directly claim an ACTIVE paid status.

## API and persistence

- `GET /api/billing/businesses/:businessId`: owner-only status, original terms,
  team usage and published trial offers; checkoutAvailable is always false.
- `POST /api/billing/businesses/:businessId/trial`: `{ planId }`, owner-only,
  one subscription record per business and no trial restart after expiration.
- `GET|POST /api/billing/plans`: Super Admin catalogue/create. Paginated listing.
- `PATCH /api/billing/plans/:planId`: `{ revision, published }`, Super Admin.
- `GET /api/billing/audit`: paginated Super Admin billing history.

Plan fields include unique code, English/Arabic names, integer priceMinor or
null for trial-only, currency, month/year interval, trial days and limits.
Supported draft currencies currently all have two decimal places. Decimal text
is converted to minor units without floating-point multiplication. The API
rejects fractional minor amounts, invalid/negative limits and unknown fields.

Writes require exact origin, JSON, CSRF, current live account/role and required
MFA. No Super Admin bypasses customer billing ownership. Audit entries commit
with plan changes/trial creation, and private plan history is not exposed in
customer business activity. Duplicate plan codes return 409, including races.

## Entitlement boundary

`requireMemberCapacity` runs inside the same serializable transaction as every
existing staff-growth path: both invitation creation APIs, invitation acceptance
and disabled-membership reactivation. Per-business transaction advisory locks
coordinate capacity checks; transaction retries handle serialization conflicts.

Usage = active memberships (owner included) + valid pending invitations. Disabled
platform accounts still occupy their active membership places. Re-sending an
invitation replaces its reservation. Revoked/expired invitations free capacity.
Acceptance exchanges an invitation place for a membership, and rechecks the
trial at acceptance time. Concurrent requests cannot oversubscribe the last seat.

No subscription or expired trial fails closed for staff growth. Existing records,
settings, billing access, role changes, disabling members and invitation revocation
remain available. Expiration is evaluated from stored timestamps, so it does not
depend on a scheduled job. Repeated trial starts cannot extend the end date.

Warehouse/shop allowances are stored and displayed; their usage enforcement must
be connected when Service 6 introduces those resources. No warehouse/shop API
exists yet. Operational write access/feature entitlements likewise must be wired
as those modules are introduced. These are not claims of full SaaS enforcement.

## Existing PayPal assessment

The legacy `backend/subscriptions.py` sells the AI assistant, not this new B2B
product: monthly USD 29, yearly USD 299 with a configured launch price of USD 99,
and a 30-day assistant trial. Those terms and provider plans are untouched and
are not copied into the new product. No legacy subscription IDs are imported.

Observed migration requirements:
- Legacy activation accepts a browser-supplied provider subscription ID. New
  checkout must be created server-side, tied to a business-owned checkout intent,
  and uniquely bind a provider subscription to its verified intended business.
- Provider approval is not a locally inferred payment. Verify provider plan,
  ownership binding, status and actual billing/payment evidence server-side.
- Legacy webhook event insertion precedes state mutation. The new integration
  needs durable, atomic processing with retries, replay deduplication and a
  reconciliation strategy for unknown/out-of-order events.
- Legacy payment rows include checkout and lifecycle operations. New payment
  history must distinguish real settled transactions from subscription actions.
- Do not infer paid period ends by adding 30/365 days to webhook receipt time.
- Avoid creating a second paid subscription during retries or legacy migration.

Reviewed official PayPal references on 11 November 2026:
- https://developer.paypal.com/api/subscriptions/v1
- https://developer.paypal.com/api/rest/webhooks/
- https://developer.paypal.com/subscriptions/webhooks

## Remaining Service 5 work

1. Expose the tested internal checkout workflow only after paid entitlement and
   lifecycle handling are complete; provider/intent internals now exist.
2. New B2B PayPal product/plan mappings, sandbox validation, then approved pricing.
3. Extend the implemented durable webhook/receipt processing with paid-period
   reconciliation and refund/reversal handling.
4. Renewal/failure/grace/cancellation/refund rules and owner billing UI.
5. Controlled legacy mapping with safeguards against duplicate billing.
6. Production provider configuration and end-to-end sandbox validation before
   enabling checkout. Real provider calls, credentials and payments were not used.

Unknown pricing does not block further provider-adapter implementation, but paid
plan publication and commercial checkout must remain disabled until configured.
The paid-plan draft UI records possible future terms; it is not a checkout flow.

## Verification

- Migration 202611110005_billing_foundation applied to isolated PostgreSQL 16.
- 51 integration tests + 7 HTTP/configuration tests passed (58 total).
- 11 billing tests cover tenant/admin separation, plan validation, immutable
  terms, paid-publication denial, CSRF, one-time/concurrent trial start,
  concurrent seat reservations, offer withdrawal, reactivation, expiry,
  acceptance-time checks, private audit and duplicate plan races.
- Backend typecheck/build and frontend production build passed.
- Billing Playwright flow passed against the real API/DB: plan create/publish,
  trial confirmation/start, invitation limits, expiry/no restart, AR/EN layouts
  at 320/390/768/1440px, mobile plan form and Escape focus return.
- Existing business browser regression retained with explicit trial fixtures.
- Screenshots in ../tmp/billing-design; inspected active trial desktop, expired
  trial Arabic mobile and localized plan form. Existing legacy subscription page
  and its separate dark pricing style are unchanged.
