# Services 13–17: local implementation

Implemented on 2026-11-11 in the optional `/business-v2` workspace. The existing
legacy app and MongoDB data are unchanged. User confirmed that hosting/customer
exports are not ready and requested local preparation for Service 17.

## 13 — customer and supplier returns

A return references one completed sale or receiving document at its original
location. Quantities are base units, including sales originally made as packs.
Each source line can appear once per return. Separate returns can record different
conditions on the same original line. Submitted quantities plus all posted prior
returns cannot exceed the original quantity; concurrent approvals are protected
by serializable transactions. Drafts do not move stock.

Customer condition RESTOCK increases sellable stock; DAMAGED creates a return
credit without increasing sellable stock. Supplier returns reduce stock, preserve
reservations and create credit against their original receiving document. They
also appear in the supplier's history. Credits use the original discounted sale
line amount or rounded receipt line cost, not today's catalogue price.
Cumulative proportional rounding ensures a full return credits exactly the
original line total. If another return changes a draft's rounded credit, approval
requires a fresh draft; it never silently changes the reviewed amount.

Return approval posts stock, credits, approval identity/time and audit together.
Refunds are separate real-money records in Service 15. Completed returns and their
lines cannot be rewritten. Incorrect drafts can be cancelled and recreated.
There is no unlinked goodwill refund, exchange, cross-location return, or
quarantine inventory workflow in this release.

## 14 — physical counts and damage

Choose a product/location before counting. A snapshot captures the expected
quantity and an opaque history revision token. Enter actual counted quantity,
including zero, and a reason. Approval posts only the discrepancy. Both draft
creation and approval reject changed snapshots. The token uses append-only ledger
row count, so two movements with the same timestamp or net-zero movements still
invalidate a count. Index 016 supports this lookup.

Damage drafts record positive quantities to remove, with a reason. Approval
requires enough unreserved stock; a failure in any line rolls back all lines.
Counts and damage have explicit approval permissions, immutable completed records,
client-key creation idempotency, revision checks and repeat-safe approval.
Products omitted from a count are unchanged; this is a selected-product count,
not an automatic zeroing of the whole location. Active adjustment drafts prevent
location archiving.

## 15 — payments, balances, refunds, expenses and daily cash

Money entries record a payment already made. They do not call a payment provider
or change stock. Methods: CASH, CARD (external terminal), TRANSFER. Noncash records
require a reference. All records require a reason and exact currency precision.
Kinds: SUPPLIER_PAYMENT, SUPPLIER_REFUND, CUSTOMER_REFUND, EXPENSE, CASH_IN, CASH_OUT.
Entries are immutable with durable client-key replay protection and audit.

- Supplier payable = rounded receiving total − posted supplier return credits −
  payments + supplier refunds. Only the positive remainder can be paid. If net
  payments exceed the remaining purchase value, that difference can be recorded
  as received back from the supplier. Credits are tied to the original receipt;
  cross-receipt credit allocation is not implemented.
- Customer refund due = approved customer return credit − recorded refunds.
  Partial refunds are allowed, but simultaneous payments cannot exceed the due
  amount. This does not introduce customer credit sales/accounts.
- Receiving amounts round each base-quantity × original base-unit cost to the
  business currency precision, then sum. The older receiving screen also retains
  its exact eight-decimal calculation; payable reports use currency-rounded values.
- Cash In/Out records represent real drawer additions/withdrawals. Sales contribute
  the paid sale amount, after change, automatically. Expenses and refunds contribute
  according to direction and method. Noncash entries do not affect the drawer.

A daily closing records location, business-local date, opening cash, cash in/out,
expected cash, physical count, variance, reason, employee and closing time.
Expected = opening + cash in − cash out. A nonzero variance requires explanation.
The server rechecks the reviewed expected amount before finalizing. Business-row
locking coordinates cash sales, entries and closing; a closed day rejects later
cash activity at that location. Closing is final, has no reopen/edit endpoint and
is repeat-safe. Future dates are rejected. Timezone becomes fixed after payment
activity so previously closed days cannot be reclassified. Currency locks at the
first money entry or close, even without products.

Opening cash is an explicit physical amount, not an automatically carried balance.
No shifts, till hardware integration, split POS payments, bank settlement imports,
or expense approval queue is included. Posted records cannot be edited.
Audited payment reversals are now implemented; see the update below.

## 16 — dashboard and reports

Reports include scoped stock, low-stock filtering, completed sales, receiving,
returns, payment entries, supplier outstanding/refund balances and customer refund
balances. The overview shows sales after discounts, return credits, net sales,
expenses and cost-gated estimated profit. Reports use business-local date
boundaries, including DST; exported timestamps retain explicit UTC ISO timestamps.
Current stock and outstanding balances are explicitly all-time/current and ignore
the activity date range.

Estimated profit uses saved sale costs, reverses cost only for sellable customer
returns, and subtracts recorded damage cost, transfer-loss cost and expenses. It
includes stock-count valuation changes and excludes tax; it is not FIFO or
statutory profit reporting. Transfer losses are valued at catalogue cost when
recorded and attributed to their source location on the loss event date. Historical
losses without a saved cost leave estimated profit unavailable, with an explicit
UI explanation; no historical value is invented. Cost fields remain permission
gated, and transfer-event responses never expose the internal cost snapshot.
Current stock value uses today's catalogue purchase cost and is labelled estimated.
Counts in different physical units are not added into one misleading quantity.

CSV exports use exactly the same scope/cost checks as on-screen reports, contain
only posted activity, escape spreadsheet formula prefixes and produce an audit
entry. Display pages contain 25 rows; a report/export is capped at 10,000 source
rows and a date range at 366 calendar days. Oversize reports return an explicit
error requesting a narrower location/date range, never a silently truncated total.
Supplier balances use batch aggregates rather than per-receipt queries.

## Permissions

All new endpoints use live session/MFA, tenant, suspension, location assignment,
origin and CSRF checks. Super Admin does not bypass customer authorization.
Read/report access is separate from posting entitlement; writes require an active
trial/subscription. Completed operation replays still require live permissions.

- `returns.view/create`: warehouse, shop and cashier staff, operations manager,
  owner. Customer source lookup uses completed sales; supplier source lookup also
  requires purchasing view. Supplier approval additionally requires purchasing
  manage, so a shop manager cannot silently approve a supplier return by default.
- `returns.approve`, `counts.approve`: owner, operations manager, shop manager.
- `counts.view/create`: those roles plus warehouse staff.
- `payments.view/manage`: owner, operations manager, shop manager. Supplier payment
  details/actions additionally require catalogue cost and purchasing authority.
- `cash.close`: owner, operations manager, shop manager; explicitly authorizes
  viewing aggregate drawer inflows/outflows, including supplier cash payments.
- `reports.view`: owner, operations manager, shop manager, viewer. Purchase totals,
  valuations and estimated profit remain cost gated. Payment views require payment
  view authority. Reports do not confer cross-location access.
- `migration.manage`: owner only.

## HTTP surface

Prefix `/api/businesses/:businessId/workflows`:

- `GET /snapshot?locationId=&productId=`: capture a count-start snapshot.
- `GET /adjustments?kind=&page=&locationId=&status=&supplierId=`: scoped history.
- `GET /adjustments/source/:id?kind=CUSTOMER_RETURN|SUPPLIER_RETURN`: original
  lines and remaining returnable quantities, with cost redaction.
- `POST /adjustments`, `GET /adjustments/:id`.
- `POST /adjustments/:id/status {revision, action:confirm|cancel, confirm:true}`.
- `GET /payments?page=&locationId=`, `POST /payments`.
- `GET /balances/:id?kind=SUPPLIER|CUSTOMER`.
- `GET /cash?locationId=&day=`, `POST /cash` with reviewed expected cash.
- `GET /reports?view=&from=&to=&locationId=&page=&lowStock=&export=`.
- `GET /migration`, `POST /migration/preview`,
  `POST /migration/:id/confirm {confirm:true}`.

Migrations 015/016 add the new records, constraints, immutable triggers and lookup
index. API readiness requires `operations-completion-v1`. Apply migrations before
running the new API. Do not use tests against a customer database.

See `ROLLOUT.md` for Service 17 tools, pilot scenario and launch gates.


Final verification for Services 13–17: 179 backend tests passed across the suites
(159 PostgreSQL integration, including 23 completion-service cases, plus 20 HTTP/
provider tests). Source, test and browser-script typechecks and both production
builds passed. After the final cash timestamp adjustment, all 39 completion/POS
cases passed again. Full real-API browser workflows passed at all five AR/EN widths;
final supplier history/count detail changes were rechecked at 320/390/1440, including
Arabic return/payment dialogs and keyboard focus. No page errors or horizontal
page/dialog overflow. Synthetic legacy CLI analysis passed without modifying its
source. Local restore verified 42 tables and immutable triggers. Evidence is in
`tmp/completion-design`; no live deployment or physical-device certification.

## Inventory, money and concurrency audit — 12 November 2026

The six targeted suites passed 90 tests on an isolated PostgreSQL database with
Node 22. `operations-audit.test.ts` extends the existing rollback/idempotency
coverage with:

- A 60-unit purchase in six-unit packs, received in two deliveries, supplier
  settlement/credit/refund, partial transfer arrivals, goods returned from transit,
  transit loss, discounted taxed sales across cash/card/bank-transfer records,
  sellable/damaged customer returns and refunds, damage, count and cash closing.
- Every checkpoint compares on-hand balances with the immutable movement ledger.
  Final warehouse/shop stock is 38/6. Shop sales are 44.10, returns 14.70, net
  sales 29.40, estimated profit 8.00; the warehouse separately recognizes 2.00
  transit loss. Opening cash 50 + sales 28.35 − refunds/expenses 11.45 closes at
  66.90 with zero variance.
- Five bursts of eight sale attempts against three units, followed by retries:
  exactly three successes each round, five stock conflicts, no overselling.
- Five checkout-versus-dispatch races for the same last two units: one winner,
  one stock conflict, one movement, and a payment only if checkout wins.
- Actual HTTP connection loss after successful checkout/payment commits, followed
  by eight concurrent retries: one durable payment and one set of stock/audit rows.
- Seventeen tiny partial returns reconcile the original 30 cents including one
  cent of tax, without negative tax or tax exceeding a refund.
- Transit-loss valuation is immutable after product-cost changes, scoped to the
  source location, hidden from cost-blind staff, and explicit about unknown legacy
  values. A regression first reproduced profit 0 instead of −2 for a transit loss;
  the new snapshot migration and reporting calculation correct it.

Purchasing, transfer, sales and completion browser suites passed, including
barcode input modes, pack quantities, partial receipts, role restrictions,
refund/payment recording, cash close, print/export and AR/EN at five widths.
The loss-report browser suite additionally checks known and unknown historical
cost states on dashboard/reports at 320/390/768/1024/1440px, without overflow or
runtime errors. Evidence: `tmp/operations-design`, `tmp/transfers-design`,
`tmp/sales-design`, `tmp/completion-design`, `tmp/transfer-loss-report`.

Card/bank transfers here are manually recorded external payments, not gateway
charges. The tests do not exercise live payment providers or physical scanners.

## Tenant isolation and access audit — 2026-11-12

Validated against a freshly migrated, isolated PostgreSQL test database, with real Express requests and session cookies. All 216 existing integration tests passed; four additional adversarial regressions passed with their suites (52 tests). The 27 HTTP/security/provider-client unit tests and application/test TypeScript checks also passed.

Additional regressions in `tests/catalogue.test.ts` and `tests/completion.test.ts` cover:

- A caller with owner memberships in both businesses cannot read or mutate business B's product/image through business A's URL. Positive controls retrieve the actual image through B; denied writes leave its contents and product unchanged.
- Disabling staff through the membership API immediately invalidates their existing cookie for product reads, image access and writes.
- All eight report/export views remain business-scoped and reject foreign location filters, even for a dual-business owner. A seeded foreign stock marker appears only in its own business export.
- Report/export authorization is rechecked after live role or membership changes using the same cookie.

Existing passing regressions cover uploader/tenant-bound encrypted import previews, subscription checks at import commit and sale checkout, invitation acceptance after trial expiry, concurrent seat/location limits, reactivation limits, custom-role changes, session revocation, account disabling, and platform administrators without customer membership. Expired subscriptions intentionally retain historical reads and permitted reductions; they block covered growth and operational writes. This audit did not introduce a new subscription policy.

No additional authorization defect was reproduced in these scenarios. This is local API regression evidence, not a production infrastructure penetration test or verification of live payment-provider behavior.

## Local UI journey and recovery verification — 2026-11-12

Executed through automated Chromium UI interactions against the local React application and isolated PostgreSQL test database. The interactive computer-use browser connection was unavailable; these are repository Playwright checks, not a manual device or assistive-technology certification. No production email or payment was sent.

### Complete business journey

`npm run test:browser:journey` (`scripts/full-journey-browser.ts`) passed:

1. New account registration, real verification-link consumption, login and TOTP setup — passed. Email token was read from the local encrypted outbox; external delivery was not exercised.
2. Trial activation — passed using a published test-plan fixture. Business, owner and subscription were created/activated through the UI.
3. Warehouse and shop creation — passed.
4. Cashier invitation, acceptance, login, restricted navigation and shop assignment — passed.
5. Product/barcode setup and supplier receiving — passed. Drafts left stock unchanged; confirmation received 100 rice, 60 milk and 40 oil.
6. Transfer dispatch and receiving — passed: 20 rice, 24 milk, 12 oil moved into the shop.
7. Sale, return and refund — passed: $29 sale, $50 tender, $21 change; one milk returned/restocked and $3 refunded.
8. Damage/count adjustments, supplier payment and cash closing — passed: $200 supplier payment, $15 expense; opening cash $100 closed at $111 with zero variance. Six stock balances reconciled to 192 units. Supplier balance export showed $520 outstanding. Estimated profit is −$14, including the $4 count loss; the older grocery test expected −$10 and was corrected.

Screenshots and export: `tmp/full-business-journey/` (00a–00d onboarding/staff, 01–06 operational steps, 07 Arabic/English report views).

### UI coverage and fixes

`npm run test:browser:ui-coverage` passed 21 owner navigation sections in both languages (42 screen/language combinations), each at 390, 768 and 1440 pixels. It checks keyboard activation, visible input labels, unexpected alerts, runtime errors, horizontal overflow and usable table-search widths. Sections: dashboard, reports, products, sales, purchases, inventory, returns, expenses, treasury, counts/damage, migration, transfers, suppliers, locations, subscription, team, roles, invitations, audit, account security and settings. Screenshots and machine-readable results: `tmp/ui-coverage/`.

The auth-mock, auth-resilience, locations, catalogue, import, operations, transfers, sales, completion and admin-services browser suites also passed. Operational form suites retain their full 320/390/768/1024/1440 coverage where defined. These exercise validation errors, empty states, scanner Enter behavior, permission restrictions, modal Escape/focus return, receipts, reports and exports. The initial import screenshot loop hit the existing rate limit; it now resizes a single preview per language instead of repeatedly uploading. Production limits were not weakened.

Two reproduced UI defects were fixed within the existing design system:

- **Offline preview trapped users in the import dialog.** Cancel/Escape no longer depend on a successful discard request. Discard remains best-effort; abandoned encrypted previews expire after 30 minutes and do not create products. Before: `tmp/recovery-ui/before-offline-cancel.png`; after: `tmp/recovery-ui/dismiss-{en,ar}-{390,1440}.png`.
- **Table search collapsed at tablet widths.** The shared search field now has a minimum readable width and the export control wraps. Before: `tmp/ui-coverage/before-{en,ar}-768-team.png`; after: `tmp/ui-coverage/{en,ar}-768-team.png`. No theme or navigation redesign.

### Failure recovery through the UI

`npm run test:browser:recovery` passed:

- Interrupted workbook preview: visible connection error, no products written, retry succeeds.
- API offline with preview open: Cancel and Escape dismiss it in Arabic/English at mobile/desktop widths; keyboard focus remains contained while open and returns to the trigger or accessible catalogue retry message when closed.
- Import commit succeeds but its response is lost: kill the isolated API process with SIGKILL, restart it using the same database/encryption key, click Confirm again; exactly one imported product and one import audit remain.
- Checkout succeeds but its response is lost: kill/restart the isolated API, click completion again; exactly one payment and one sale stock movement, stock 10 → 8.

Screenshots: `tmp/recovery-ui/`. These cases cover interruption before preview and response loss after commit; they do not claim coverage of every possible OS/database crash point. Child API processes and fixture business records are cleaned up. Frontend production build and backend/application-test TypeScript checks passed. The existing large frontend bundle warning remains a performance follow-up.

New scripts expect `TEST_DATABASE_URL` ending in `_test`, installed Playwright Chrome, and the frontend on localhost:3300 configured with `REACT_APP_AUTH_API_URL=http://localhost:4300` and `REACT_APP_B2B_PRIMARY=true`. They run isolated API listeners on 4301 (journey), 4302 (recovery) and 4303 (UI coverage).

## Closing reports by email and in app — 2026-11-12

Business admins now have **Dashboard & reports → Closing reports**. Each authorized admin configures their own verified account email and personal in-app report history; arbitrary recipient addresses are not accepted. Automatic delivery starts disabled. The `reports.deliver` permission is available to owners and operations managers by default and can be delegated through existing roles. Each report also requires its underlying sales/cost/payments/returns/cash permissions and location access. Platform admin status does not bypass business membership.

Available sections: sales, gross profit, estimated net profit, recorded expenses, customer returns and cash closing. Reports use the chosen English/Arabic language in both channels. Gross profit excludes sales tax and subtracts recorded net cost of goods sold. Estimated net profit additionally accounts for recorded expenses, damage, transfer losses and inventory counts; missing historical loss costs produce “Unavailable,” not a misleading number. The report explicitly excludes unrecorded costs.

- Automatic: each successful daily cash close queues one report per enabled, eligible recipient, scoped to the closed location and business day. Closing retries do not queue duplicates. Email preparation/SMTP do not block cash closing.
- Manual: save settings, select dates/location in the existing report filters, then **Send report now**. This works while automatic delivery is off. Same-key request retries return the original report. Manual sends are limited to ten requests per account/hour.
- Web app: recent report history shows preparing, ready/email queued, sent, failed or cancelled. **View report** displays the same saved content used for email. The open history refreshes every 15 seconds and also has a refresh button. History currently shows the latest 50 reports.
- Privacy: settings and history are scoped to business and recipient; roles, membership/account state, verified email, subscription and location access are checked before preparing and again before email dispatch. Disabled automatic delivery cancels queued automatic reports. Previously prepared reports remain readable while the recipient retains access. Snapshots and queued mail are encrypted.
- Snapshot timing: day boundaries use the business timezone; transaction totals include activity recorded by the request/close timestamp, not later postings. Cash-close rows are immutable. Manual reports can cover up to 366 days.

Migration: `20261112130000_closing_reports` adds report preferences/deliveries and an optional report reference on the existing encrypted mail outbox. Existing business data is preserved. `summaryTotals` is shared by interactive and delivered reports to avoid divergent profit calculations.

### Workers and local availability

`src/jobs.ts` now runs report preparation before the existing SMTP worker. Production uses the existing jobs service with the same database and encryption key as the API. `npm run reports:prepare-once` prepares a bounded batch; `node dist/reports/worker.js --watch` prepares batches every 15 seconds without sending emails. Preparation claims use retryable leases, and the saved report plus email outbox row commit together. SMTP uses the existing bounded retry policy; SMTP acknowledgement loss can still cause an email retry, so delivery is not advertised as exactly-once at the external provider.

The additive migration is applied to local staging, its API is restarted, and a staging report-preparation watcher is running. SMTP is **not configured in `.env.staging`**. The UI explicitly says that in-app reports can be prepared but queued email will not send until the platform administrator configures delivery. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM` for the API/jobs environment, then run the jobs service. No real external email was sent during validation.

### Validation

- Full integration suite: 228 tests passed after introducing the feature; all 10 focused report-delivery tests also passed after adding the final concurrency regressions.
- New integration cases cover disabled defaults, CSRF, fixed verified recipient, cross-business/user access, report selection, Arabic content, gross/net/cash totals, automatic close idempotency, manual request idempotency, SMTP retry, permission/subscription revocation, cancellation, report cutoffs and concurrent workers/settings.
- `npm run test:browser:closing-reports`: real UI enable/save → cash close → automatic in-app report → disable → manual send → captured email and in-app content match. Arabic/English at 320/390/768/1024/1440, report detail, staff restrictions and email setup notice passed. Screenshots: `tmp/closing-reports-ui/`.
- Read-only staging UI verification passed: `tmp/login-check/closing-reports.png`. No report preference was enabled on behalf of a real account.
- Backend build/type checks and frontend production build passed; the pre-existing frontend bundle-size warning remains.


## Audited payment and expense reversals — 2026-11-12

Treasury and Expenses now expose **Reverse entry** for eligible entries, with a required reason and explicit confirmation. Owners and operations managers receive `payments.reverse` by default; other staff need a delegated permission, `payments.manage`, `payments.view`, and location access. Supplier entries additionally require cost visibility and purchasing management. The same live tenant, session and subscription checks apply server-side.

`POST /api/businesses/:businessId/workflows/payments/:id/reverse` creates a full equal-and-opposite entry of the original kind, currency, method, location and source. Original rows remain immutable. A unique original-entry link prevents second reversals, and durable request keys make retries safe. A database trigger enforces exact matching and prevents reversing a reversal or linking across businesses. `payment.reversed` records the reason, original amount, actor and correction ID atomically.

Corrections post today in the business timezone. Earlier cash closings and saved report snapshots remain unchanged; today's cash reversals count in the opposite cash-flow direction. Today's closed drawer rejects cash reversals, while noncash corrections remain possible. Business locking serializes reversals with closing. Negative ledger amounts naturally reconcile supplier/customer balances and recorded expenses/profit; reports and CSV include the original-entry link. The UI shows Posted/Reversed/Reversal, linked history, who/when/reason, and asks users to record a correct replacement separately. This only corrects recorded transactions; it does not initiate bank/card refunds. No partial reversal, reversal-of-reversal, backdating or reopening cash closings is exposed.

Validation: all 238 integration tests passed; all 9 focused reversal tests passed after adding the final closing-race case. Real browser checks passed expense posting/reversal, response loss after commit and same-key retry, single correction/audit, cash totals, linked history, AR/EN at 320/390/768/1024/1440, keyboard containment and focus restoration. Backend typecheck/build and frontend production build passed (existing bundle-size advisory remains). Screenshots: `tmp/payment-reversals-ui/`; staging screen: `tmp/login-check/payments-after.png`. The pre-change Treasury screen was also captured and visually inspected during implementation.

Migration `20261112140000_payment_reversals` is applied to isolated test and guarded local staging databases. Staging API restarted; no real business payment was reversed during verification.
