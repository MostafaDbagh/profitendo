# B2B PayPal transport and durable event processing

Implemented locally on 11 November 2026 as Service 5, part 2. Paid checkout is
still disabled. No provider credentials, external PayPal calls, real payments,
plan publication or production deployment were used during implementation.

## Boundaries

The new adapter uses only B2B_PAYPAL_MODE, B2B_PAYPAL_CLIENT_ID,
B2B_PAYPAL_CLIENT_SECRET and B2B_PAYPAL_WEBHOOK_ID. It never uses the legacy
assistant PayPal settings. Missing credentials disable webhook intake explicitly;
partial credentials fail startup without exposing their values. Sandbox/live use
fixed HTTPS API origins. A hash of mode/client ID scopes intents, receipts and
event deduplication, isolating apps and environments. Secret rotation does not
change that scope.

No public checkout HTTP endpoint is mounted. Paid-plan publication remains
blocked and owner status still reports checkoutAvailable=false. The internal
CheckoutService is implemented and tested for the later checkout workflow.
Neither a provider ACTIVE status nor a receipt changes business entitlements.
The existing trial lifecycle and seat gates remain authoritative for now.

## Provider client

- OAuth token caching and coalesced concurrent refresh; a rejected token is
  invalidated for a subsequent retry.
- Fixed provider paths, validated IDs, 20-second request timeout, no redirects,
  bounded JSON response size and sanitized upstream errors.
- Subscription creation sends the stored intent UUID as PayPal-Request-Id and
  custom_id. Return/cancel URLs come from configured APP_ORIGIN, not the browser.
- A fresh provider GET validates ID, merchant plan, custom_id, quantity and plan
  overrides. Additional shipping charges are rejected.
- Plan verification requires an exact amount/currency, a single unlimited
  regular monthly/yearly cycle, one unit, no provider trial, setup fee or taxes.
  Creation requires an active plan. Existing event processing permits a withdrawn
  plan with unchanged terms, since withdrawal need not stop existing agreements.
- Approval URLs are restricted to the configured PayPal environment and known
  billing approval path. Credentials and provider response bodies are not logged.

## Internal checkout intent

A unique persistent business intent prevents automatic creation of a second
agreement. The business owner is checked before provider calls; owner access is
revalidated before returning provider state. Platform admin has no tenant bypass.
Provider calls happen outside serializable database transactions.

A leased attempt uses the same request ID on ambiguous retries. A provider
subscription is accepted only after its custom_id and plan match the intent.
Binding persists even if owner access changes during the provider call; losing
that link could permit duplicate billing. A final authorization check prevents
returning the result to a newly revoked caller.

PayPal documents a 72-hour retention window for subscription creation request
IDs. Unresolved attempts older than 70 hours are held for reconciliation, never
silently assigned a new ID. This margin is conservative, not proof of provider
sandbox behavior. A cancelled intent is not automatically replaced: resubscription
and checkout cleanup remain part of the next lifecycle implementation.

## Webhook inbox

`POST /api/billing/paypal/webhook` is independent of customer cookies and CSRF.
PayPal signature verification is mandatory before storing an event. Only the
fixed PayPal verify endpoint is contacted; certificate URLs are validated but
are never downloaded by this application. JSON/body limits remain enforced.
The response acknowledges successful durable receipt with 202, not completion.

The original verified event is encrypted with per-row authenticated context.
Deduplication uses (provider scope, event ID) and a canonical payload hash. Exact
replays are acknowledged; a different verified payload under the same event ID
is rejected. Database errors are not mistaken for duplicate delivery.

Run `npm run billing:webhooks-once` under the same database, encryption key and
B2B provider configuration as the API. Deployment must arrange repeated worker
runs; no background scheduler was created here.

Workers claim due rows using FOR UPDATE SKIP LOCKED and a 2-minute fenced lease.
A new lease token prevents stale workers from committing. Expired processing
leases are reclaimable. Transient failures use bounded exponential delay, then
REVIEW after ten failed attempts. Unknown subscription bindings are retried so
an event arriving before checkout persistence is not silently lost.

Supported processing:
- Subscription lifecycle events refresh from the current provider GET, validate
  stored ownership/plan, and update provider status without regressing timestamps.
- PAYMENT.SALE.COMPLETED creates an immutable receipt from verified event money
  and payment time. Lifecycle approval is never recorded as a payment. Receipt
  deduplication also uses provider transaction ID, covering separate event IDs.
- State/receipt writes and inbox completion commit atomically. Losing a lease
  rolls back all of them. Completed/ignored event payloads are cleared; hashes
  and safe operational metadata remain for duplicate checks.
- Refunds/reversals, binding conflicts, inconsistent transactions or unsupported
  money require REVIEW. Refund accounting and paid-access adjustment are not yet
  implemented. Unrelated unsupported events are marked IGNORED.

## Operator and owner endpoints

- `GET /api/billing/provider-events?page=1`: Super Admin only; safe queue metadata,
  status, retry count and error codes. No encrypted or decrypted payload returned.
- `POST /api/billing/provider-events/:eventId/retry`: Super Admin + origin/JSON/
  CSRF; REVIEW only, same configured provider scope. The retry is audited.
- `GET /api/billing/businesses/:businessId/payments?page=1`: owner-only receipt
  history with masked references, exact minor-unit amounts and provider payment
  timestamps. No full transaction ID, subscriber details or event payload.

Receipt history appears in the existing business subscription pane, using the
same light design, translated empty/error states, table/pagination and RTL rules.
Receipts describe original completed sales; they are not invoices, tax documents,
net-after-refund totals or proof of current subscription entitlement.

## Verification and evidence

- Migration 202611110006_paypal_inbox applied to isolated PostgreSQL 16.
- 86 backend tests passed: 19 HTTP/provider-unit tests and 67 database integration
  tests. New provider tests cover request IDs, OAuth, unsafe IDs/URLs, signatures,
  money parsing, binding, timeouts, duplicate checkout/events/transactions,
  stale states, worker lease loss/recovery, retry/review and owner/admin boundaries.
- Provider HTTP contract tests inject mock fetch responses. Database integration
  tests use a fake provider with real PostgreSQL transactions. These do not
  establish that real PayPal sandbox credentials/merchant plans are configured.
- Backend typecheck/build and frontend production build passed.
- Receipt browser checks use real local API/auth plus explicitly seeded isolated
  presentation fixtures: empty/error/retry, pagination, business switch, masking,
  AR/EN 320/390/768/1440px. Screenshots: ../tmp/receipt-design/.
- Visual review also found and fixed RTL reversal of the used/maximum team count.

## Remaining release work

Service 5 remains in progress. Implement paid-period entitlement and reconciliation
from provider payment evidence; renewal failures/grace; reactivation;
refund/reversal records and access effects; merchant-plan mapping; audited replay
operations UI/retention policy; secure customer checkout UI; resubscription and
ambiguous checkout recovery; controlled legacy mapping; real sandbox verification.
Suspended businesses now have narrowly scoped owner billing-recovery access
without operational access. Choose/approve pricing and configure new
B2B merchant plans before enabling paid publication or checkout.

Official provider references reviewed on 11 November 2026:
- https://developer.paypal.com/api/subscriptions/v1/subscriptions-create
- https://developer.paypal.com/api/subscriptions/v1/subscriptions-get
- https://developer.paypal.com/api/subscriptions/v1/plans-get
- https://developer.paypal.com/api/rest/reference/idempotency/
- https://developer.paypal.com/api/rest/webhooks/


## Durable owner cancellation (11 November 2026)

Migration 007 adds a unique durable cancellation request for each checkout.
An owner request records intent and an audit row before any external call. The
worker claims bounded leases, checks current provider binding/state, requests
cancellation, and fetches confirmation. Neither an empty provider success response
nor a timeout marks cancellation complete. Ambiguous replies are reconciled on
retry; already-terminal subscriptions do not receive a duplicate cancellation.
Fenced transactions prevent expired workers committing local success. Ten failed
attempts or permanent binding/state conflicts require review. Requests survive
session expiry and business suspension after authorization.

- GET `/api/billing/businesses`: minimal owner business list, including suspended.
- GET `/api/billing/businesses/:businessId/cancellation`: safe request/status data.
- POST same path with `{ "confirm": true }`: owner + MFA + CSRF, durable 202.
- GET `/api/billing/cancellations`: Super Admin queue metadata only.
- POST `/api/billing/cancellations/:id/retry`: audited Super Admin REVIEW retry.
- `billing:webhooks-once` now processes cancellation requests before webhooks.
  Production scheduling is still required; it has not been deployed.

`requireBillingOwner` is limited to owner billing reads and cancellation. It checks
live sessions, MFA and active ownership, allows suspended businesses and never
permits disabled memberships/accounts. Checkout, trials and operational APIs keep
the normal suspension checks. Platform administrators have no tenant bypass.

The bilingual `/billing-v2` page is linked from account security and remains
usable for suspended businesses. It uses the existing components and distinguishes
requested, processing, confirmed and review states. Receipt history stays intact.
No refunds, paid access grants or reactivation are implied by cancellation.

Real local browser/API/DB checks passed with a fake provider; no real payment
requests were made. Contract reference for cancellation and its empty 204 reply:
https://developer.paypal.com/api/subscriptions/v1/subscriptions-cancel
