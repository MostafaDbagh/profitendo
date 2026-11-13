# B2B SaaS delivery progress

Updated 2026-11-11. Existing frontend/design remains the reference; see
DESIGN_SYSTEM.md. New API lives in backend-node. Legacy FastAPI remains active.

## Order and revised planning ranges

These are preliminary developer-day ranges for ONE experienced full-stack
engineer, including module testing. They replace the old extension-only
estimate; they are not delivery commitments. Hosting, customer data volume,
billing-provider configuration and pilot feedback remain unknown.

| # | Service | Days | Status |
|---|---|---|---|
| 1 | Application foundation | 3-5 | Implemented; verification recorded below |
| 2 | Authentication, sessions, invitations, privileged MFA | 7-10 | Implemented and locally verified; SMTP/deployment pending |
| 3 | Businesses, roles and permissions | 6-9 | Implemented and locally verified; business-level scope |
| 4 | Platform administration | 4-6 | Implemented and locally verified |
| 5 | Subscription and billing | 8-12 | Local lifecycle implemented: gated checkout, verified paid periods, renewal reconciliation and refund holds; pricing/sandbox and commercial policies pending |
| 6 | Warehouses, shops and assignments | 4-6 | Implemented and locally verified; operational stock integration follows |
| 7 | Catalogue, units, barcodes and import | 7-10 | Implemented locally: CRUD/import, images, managed units/categories, pack setup and retirement |
| 8 | Inventory engine | 9-13 | Implemented locally: balances, immutable ledger, transactional posting and stock UI |
| 9 | Suppliers | 3-5 | Implemented locally: profiles, activity and scoped purchase history |
| 10 | Purchasing and receiving | 8-12 | Implemented locally: direct receiving, orders/partial deliveries, barcode UI and atomic confirmation |
| 11 | Transfers | 6-9 | Implemented locally: dispatch, transit, partial arrivals, returns/loss resolution and scoped UI |
| 12 | Sales/POS | 7-10 | Implemented locally: shop-scoped barcode/pack sales, exact pricing, atomic checkout and printable receipts |
| 13 | Customer and supplier returns | 6-9 | Implemented locally: linked partial returns, conditions, credits, limits and approval |
| 14 | Counts and damage | 4-6 | Implemented locally: count-start snapshots, discrepancy approval, damage and immutable history |
| 15 | Payments and daily cash | 7-10 | Implemented locally: supplier payments/refunds, customer refunds, expenses, cash movements and closing |
| 16 | Dashboard and reports | 5-8 | Implemented locally: scoped reports, balances, low stock, estimated profit and CSV export |
| 17 | Migration, pilot and rollout | 10-15 | Local preparation implemented: legacy analysis, opening preview/post, reconciliation, automated pilot and restore rehearsal; production/data pending by user instruction |

Subscription & Billing is now explicitly included, shifting the earlier PDF's
numbering from locations onward. No existing provider configuration is changed.
First operational milestone: Service 10. Authentication/tenant scope must precede
any customer-data routes. Design checks and bilingual screens are part of every
relevant module, not an end-of-project redesign.

## Foundation scope

Express/TypeScript, Prisma/PostgreSQL, validated configuration, structured safe
logging, request IDs, CORS allowlist, security headers, consistent error envelope,
liveness/readiness, graceful shutdown, initial migration, local database setup,
unit/HTTP checks and real PostgreSQL transaction tests. Service 1 exposed only health endpoints. Service 2 adds real authentication and
minimal business memberships for owner-scoped invitations; no operational
business CRUD is exposed. Full reusable tenant authorization is Service 3.

## Migration dependencies found in source

- Frontend expects /api, credentialed requests, detail errors and X-Pin-Token.
- Legacy core has JWT and session paths, business context and permission maps.
- Legacy subscriptions.py integrates PayPal activation/status/cancellation,
  payment records and verified webhooks. Map subscriptions without double billing.
- Stock currently lives globally on products. Opening balances need allocation
  to real locations and reconciliation; no historical locations can be inferred.
- Backups/imports/exports/reports and all stock-writing paths need migration.
- Actual production topology, tenant/data volume and provider account access were
  not inspected. Do not assume deployment or migration is already ready.

## Remaining release boundaries

Business-level and location-level tenant/role authorization are implemented. Paid
billing commercial verification and production deployment remain pending; operational stock workflows are implemented. Authentication, CSRF, rate limits and MFA
are implemented in Service 2; SMTP still needs provider configuration. Local Compose is development-only. No legacy schema, frontend API
base URL, customer records or credentials were modified.

## Service 1 verification results

Completed locally on 2026-11-11:
- Prisma client generated; initial migration applied to isolated PostgreSQL 16.
- TypeScript source/test checks and production build passed.
- 7 API/configuration tests passed: health, readiness failure, CORS, request IDs,
  security headers, 404/JSON/body limits, validation and safe errors/config.
- 2 real database tests passed: migrated readiness and unique-conflict rollback.
- Built Node server startup, HTTP readiness and SIGTERM shutdown passed.
- Installation audit after patched dependency updates reported 0 vulnerabilities.
- Node 22 used for verification; .nvmrc and package engines specify the runtime.
- Temporary test server/database stopped afterward. Production remains undeployed.

Service 1 handoff was authentication; implementation results follow below.


## Service 2 verification results

Implemented locally on 2026-11-11. Details: `backend-node/AUTHENTICATION.md`.
- Argon2id passwords, email verification, opaque hashed sessions, CSRF/origin
  checks, database-backed rate limits, session listing/revocation/device lock,
  password reset/change and mandatory owner/Super Admin TOTP MFA.
- Single-use recovery codes; encrypted MFA secrets/mail; one-use links;
  owner-scoped invitations; existing-account takeover protection; membership
  disabling and auth audit trail.
- SMTP worker and one-time platform-admin bootstrap CLI implemented. Neither
  real email delivery nor a real Super Admin account was created/configured.
- PostgreSQL auth migration applied successfully to the isolated test database.
- Backend typechecks/build passed; 7 API/config tests plus 17 PostgreSQL/auth
  integration tests passed (24 total).
- Fixed an actual timezone mismatch exposed by the mail lease tests: database
  connections now explicitly use UTC; a SQL-epoch regression test verifies it.
- Frontend production build passed. New optional /auth-v2 uses existing styling,
  fonts, branding, native controls, icons and bilingual layout. Existing /auth
  and operational routes remain on the legacy API.
- Playwright against the real new API passed signup, verification, MFA enrollment
  and recovery, cookie session, CSRF rejection, device lock, logout and password
  reset; 320/390px mobile and 1440px desktop AR/EN layouts checked.
- Browser testing found and fixed link handling when verification/reset fragments
  are opened in an already-loaded page. Secret link fragments are removed from
  the address bar immediately; screenshot MFA keys are masked.
- Legacy login screenshots used controlled signed-out/setup responses only for
  design baselines; new auth workflow checks used real PostgreSQL/API behavior.
- Backend dependency install audit reported zero vulnerabilities after additions.

Next: Service 3. Add centralized business-context resolution from live
memberships, a tested role/permission matrix, business/member management and
consistent authorization middleware for future modules. Build on the minimal
business/membership tables introduced for invitations. Do not equate these
foundations with complete tenant isolation across still-unbuilt workflows.


## Service 3 implementation and verification

Implemented 2026-11-11. See `backend-node/BUSINESS_ACCESS.md`.
- Central transaction-scoped authorization with live session, MFA, tenant,
  membership, suspension and permission checks. No platform-admin tenant bypass.
- Business settings, revision conflicts, currency locking, team roles and
  per-member overrides, protected ownership and session revocation on changes.
- Scoped invitation history/revocation, default role catalogue, paginated team
  and audit endpoints; audit records commit with their changes.
- Optional /business-v2 settings/team/roles/invitations/activity workspace linked
  from /auth-v2; legacy operational routes remain intact. AR/EN placeholders,
  existing light slate/emerald styling, responsive tables, keyboard dialogs.
- Backend typecheck/build, 7 HTTP/configuration tests and 30 real database tests
  passed. Added a real commit-conflict regression and bounded adapter retries.
- Frontend production build and existing authentication browser regression passed.
- Business browser checks passed real writes, stale edits, access changes,
  invitations, business switching, read-only staff and auth redirection.
  AR/EN layouts verified at 320/390/768/1440px, including focus restoration.
- Screenshots: tmp/business-design; inspected desktop team and mobile settings
  and access dialog against the original team screen.

Next: Service 4 platform administration. Keep customer membership separate from
Super Admin authority. Subscription and billing remains Service 5, followed by
warehouses/shops and staff assignments. No claim of commercial readiness yet.


## Service 4 implementation and verification

Implemented 2026-11-11. Details: `backend-node/PLATFORM_ADMIN.md`.
- Live SUPER_ADMIN + enrolled/completed MFA authorization on platform operations;
  no implicit customer business access and no role-grant/impersonation endpoints.
- Overview, searchable paginated business/account metadata, suspend/reactivate
  businesses and disable/reactivate customer accounts with required reasons.
- Revision conflict checks and atomic platform-only audit records. Suspending
  a business revokes pending invitations; disabling an account revokes sessions,
  unused auth tokens and sent invitations. Reactivation never restores them.
- All platform administrator accounts are protected from status changes. Initial
  admin setup remains the existing local bootstrap command; no real admin created.
- Optional /platform-v2 linked from authenticated Super Admin account security.
  Existing design, visible labels, helpful bilingual placeholders, confirmation
  dialogs and RTL behavior preserved. Customers receive access-denied UI.
- Migration applied to isolated PostgreSQL. Backend typecheck/build and frontend
  build passed; 47 backend tests passed (40 integration + 7 HTTP/configuration).
- Real platform browser flow passed writes, customer denial, stale-edit handling,
  session invalidation, history and AR/EN at 320/390/768/1440px. Desktop/mobile
  screenshots inspected in tmp/platform-design; dialog focus restoration tested.

Next: Service 5 subscription and billing. Assess the existing PayPal integration,
map subscription ownership and implement server-side entitlement enforcement.
Manual platform suspension does not cancel subscriptions or alter payments.


## Service 5, part 1 — configurable trials and entitlements

Implemented 2026-11-11; Service 5 remains IN PROGRESS. See backend-node/BILLING.md.
User does not yet know pricing. Provisional offer: 14-day trial, 10 team places
including owner, 2 warehouse allowances, 3 shop allowances. No paid prices set.
- Super Admin can create immutable plan terms/draft prices and publish or withdraw
  trial offers. Paid publication is blocked; existing trial terms stay unchanged.
- Owners explicitly start a one-time business trial. Status/usage appears in the
  business workspace. No automatic enrollment or extension of existing businesses.
- Server-side trial + seat checks on both invitation APIs, invitation acceptance
  and membership reactivation. Pending invites reserve places; concurrent growth
  cannot exceed limits. Expiry blocks growth while preserving records/admin access.
- Warehouse/shop allowances stored only; enforcement waits for Service 6 resources.
- Migration applied locally, backend checks/build and frontend build passed.
  58 backend tests (51 integration + 7 HTTP/config) passed; real billing browser
  flows passed AR/EN at 320/390/768/1440px with placeholders and focus checks.
  Existing business browser regression also passed with explicit trial fixtures.
- Legacy PayPal assessment: it sells the AI assistant, not the new B2B product.
  Existing subscription routes, prices, provider mappings and data remain intact.

Next work remains within Service 5: provider checkout intents, verified durable
webhooks, payment history, renewal/cancellation handling and reconciliation.
Pricing/provider configuration are needed before enabling paid checkout, but not
before further adapter implementation. Do not mark Service 5 complete or proceed
as if subscriptions/billing are ready for commercial launch.


## Service 5, part 2 — provider adapter, inbox and receipts

Implemented 2026-11-11; Service 5 remains IN PROGRESS. See backend-node/PAYPAL.md.
- Separate B2B PayPal configuration, fixed origins, OAuth single-flight/cache,
  timeouts, sanitized errors, validated plans/IDs/approval URLs and ownership.
- Internal (not publicly mounted) business checkout service persists idempotency
  IDs, protects against concurrent creation and holds ambiguous attempts beyond
  the provider retry window for reconciliation. No paid checkout was enabled.
- Signature-verified encrypted webhook inbox, durable deduplication, fenced
  worker leases, bounded retries/review, current-state lookup and atomic receipts.
  Duplicate delivery/transaction IDs do not create duplicate payments.
- Lifecycle approval never grants paid access or becomes a receipt. Refunds and
  reversals are retained for review until lifecycle reconciliation is implemented.
- Super Admin queue/retry APIs and owner-only masked receipt history. Receipt UI
  reuses bilingual operational table/pagination styles and fixes RTL team ratios.
- New migration applied locally. Backend typecheck/build and frontend build passed.
  86 backend tests passed (19 HTTP/provider unit + 67 PostgreSQL integration).
  Receipt browser checks passed empty/error/retry, pagination, tenant switching,
  masking and AR/EN responsive layouts. No real provider calls or charges occurred.

Next remains Service 5: paid entitlement/renewal reconciliation, failure and grace
policy, cancellation/reactivation, refunds/reversals, provider-plan mapping and
customer checkout wiring. Require real sandbox validation and approved pricing
before paid publication. Do not treat receipt storage as paid access authorization.


## Service 5, part 3 — cancellation and suspended-owner billing recovery

Implemented 2026-11-11. Service 5 remains IN PROGRESS.
- Durable owner cancellation requests, scope/binding validation, leased worker,
  provider-state confirmation, bounded retries/review and atomic audit/history.
- Timeout recovery checks provider state before repeating cancellation. A request
  acknowledgement never claims cancellation has completed.
- Narrow owner billing access for suspended businesses; normal operational and
  checkout access remain blocked. No staff or Super Admin tenant bypass.
- Bilingual /billing-v2 linked from account security plus cancellation pane in
  the existing subscription tab. Confirm, pending, confirmed, error/retry and
  review states. Arabic/English browser checks passed at 320/390/768/1440px.
- Fake provider only; no real payment actions. Worker production scheduling,
  real sandbox validation, paid entitlement/grace, refunds, reactivation,
  provider-plan mapping and checkout still remain.

## Service 6 — warehouses, shops and assignments

Implemented 2026-11-11. Details: backend-node/LOCATIONS.md.
- Tenant-scoped locations, immutable unique codes/types, edit/archive/reactivate,
  pagination/search and owner-managed staff assignment with database tenant FKs.
- Owners manage; operations managers see all by default; other staff only see
  assigned locations. Live permission/assignment checks reusable by stock APIs.
- Atomic warehouse/shop plan-capacity checks on creation/reactivation. Archive
  preserves records and clears explicit assignments. Actual counts shown in billing.
- Existing bilingual light design and meaningful placeholders retained. Real API
  browser flows verified create/edit, assignment isolation, archive/reactivate,
  search and error/retry at 320/390/768/1440px. Mobile table scroll stays contained.
- Migrations 007/008 applied only to the isolated local PostgreSQL database.
- Operational services can continue using trial entitlement while paid billing
  remains disabled. Do not treat this sequencing decision as completion of Service 5.

Next: Service 7 catalogue, units, multiple barcodes and import, then the inventory
engine and suppliers/receiving. Preserve the rule that product registration and
location creation never increase stock. Before stock/documents exist, extend the
location archive guard to reject remaining stock, reservations and open documents.
Services 7–17 remain to be implemented; commercial rollout is not complete.


Final verification for this batch: 99 backend tests passed (20 HTTP/provider
unit tests and 79 PostgreSQL integration tests), TypeScript source/test checks
and backend/frontend production builds passed. Cancellation and location browser
suites passed using real local API/database plus an explicit fake payment provider.
Temporary browser-test API servers and fixtures were cleaned up. Production,
legacy customer data, real payments and external mail were not changed.


## Service 7, part 1 — product catalogue and barcodes

Implemented 2026-11-11 in the optional business-v2 workspace.
- Tenant-scoped products with immutable SKU/base unit, category/subcategory/brand
  text fields, description, exact 4-decimal prices and minimum-stock thresholds.
- Multiple barcodes (up to 20), leading-zero preservation, per-business uniqueness,
  exact scanner lookup, active/inactive handling and atomic conflict rollback.
- Separate catalogue.view/manage/cost permissions. Owner and operations manager
  manage by default; other staff read without costs. No platform tenant bypass.
- Barcode changes and product changes are transactional, revision checked and
  audited without leaking purchase costs into general business audit history.
- Product registration has no stock fields or stock mutations. First product
  pricing locks base currency to prevent silently relabeling saved amounts.
- Bilingual catalogue/list/create/edit screen, useful placeholders, contained
  mobile tables and scanner-style Enter handling with focus restoration.
- Real local browser tests passed create/edit/deactivate, barcode lookup, cost
  privacy and AR/EN at 320/390/768/1440px. Physical scanner hardware was not tested.
- Found a raw-SQL conflict retry gap while running regressions: Prisma wraps
  adapter 40001/40P01 conflicts inside P2010 metadata. Added bounded retry handling
  and an immediate-trigger PostgreSQL regression, complementing the commit test.

At the end of part 1, Service 7 still needed Excel import with preview/validation/idempotent commit,
product images, managed category/unit records and pack/unit conversions. No
legacy product records were migrated. Services 8–17 and paid billing lifecycle
remain pending. Catalogue prices are per the selected unit; no automatic box-to-
piece conversion is implied by choosing BOX or CARTON.


Service 7 part 1 verification: 106 backend tests passed (20 HTTP/provider and
86 PostgreSQL integration), source/test typechecks and backend build passed.
Catalogue browser suite passed real API/DB create/edit/deactivate, scanner-style
Enter input, cost privacy and bilingual responsive layouts. Transaction conflict
handling now covers raw-query adapter wrappers and uses seven bounded attempts
with exponential backoff/jitter, returning TRANSACTION_BUSY on exhaustion.


## Service 7, part 2 — Excel preview and atomic import

Implemented 2026-11-11. Product import is available from the catalogue tab.
- Downloadable text-formatted XLSX template, single-sheet upload, row validation,
  exact decimal validation, numeric SKU/barcode rejection and preserved leading zeros.
- Creates new products only; never overwrites existing identifiers or changes stock.
  Any row error prevents commit. Existing and intra-file duplicates are identified.
- Preview payloads are encrypted, uploader/tenant scoped and expire in 30 minutes.
  Permissions, currency, entitlement and identifiers are rechecked at confirmation.
- Atomic bulk product/barcode/per-product audit writes, one batch audit and durable
  completion receipt. Concurrent/retried confirmations return the original result.
- 1 MB upload / 500 row caps; ZIP expansion/entry limits, isolated worker parsing
  with memory/time limits and bounded concurrency. Formulas, links, dates, merged
  cells, extra sheets and embedded content are rejected. No macro execution.
- Separate authenticated upload body allowance; normal API limits unchanged.
  Preview rate limits, discard endpoint and catalogue:purge-imports CLI added.
  Schedule the purge CLI before production; it has not been deployed.
- Preserved Arabic/English design. Browser tests passed template download, errors,
  no writes before confirmation, duplicate prevention and 320/390/768/1440px.
  Fixed preview grid minimum-width overflow found in screenshot review.
- Verification: 115 backend tests (95 PostgreSQL integration + 20 HTTP/provider),
  source/test typechecks, compiled-worker smoke check and backend/frontend builds.
  Dependency audit reported zero vulnerabilities after a compatible ExcelJS UUID
  override. All test workbook fixtures are isolated; no customer data imported.

Service 7 remaining: product images, managed categories/units and pack conversion.
Services 8–17 and paid subscription lifecycle remain pending.

## Service 7, part 3 — pack conversion backend

Implemented 2026-11-11. Migration 011 adds product packs with tenant-qualified
foreign keys. List/create/convert endpoints enforce live business permissions,
CSRF on writes, active-product checks and entitlement for creation. Factors are
positive decimal strings; integer arithmetic rejects unrepresentable/overflow
results. Pack definitions are immutable through the API and audited. No stock or
prices change. Up to 20 packs per product, with unique names per product.
The regression test covers scoped access, hidden cross-tenant records, invalid
factors, duplicate names, exact quantities, rounding/overflow rejection, immutable
definitions, expired entitlement and unchanged product data.

Remaining: frontend pack controls, retirement/replacement workflow, product images,
managed categories/units, then inventory and later operational services. Packs do
not yet have independent barcodes or prices. Migration applied only to isolated
test database; production deployment remains pending.


## Services 8, 9 and 10 — operational receiving milestone

Implemented 2026-11-11 at the user's explicit request to proceed to 8–10.
See backend-node/OPERATIONS.md. Service 7's remaining UI/images/reference records
are still tracked separately; skipping them does not claim they are complete.

- Inventory: exact per-location balances and availability; append-only ledger
  protected against UPDATE/DELETE in PostgreSQL, source-line uniqueness,
  serialized posting, negative/overflow protection and cost-free stock views.
- Suppliers: tenant-unique codes, contact details, revisions, active/inactive state,
  and scoped purchase history. Historical document snapshots remain unchanged.
- Purchasing: optional orders, partial deliveries, remaining-quantity enforcement,
  direct receiving, editable drafts, pending review, atomic completion, and safe
  cancellation/reopen transitions. Completed records cannot be edited/cancelled.
- Confirmation rechecks role/location/supplier/product/trial and commits stock,
  movement history, order progress, receipt status and audit together. Replays
  never post twice. Draft creation has a durable client idempotency key.
- Added permissions and cost privacy. Warehouse/shop staff prepare receipts by
  default; owner/operations manager confirm. Super Admin has no tenant bypass.
- Location archive guard now rejects stock/reservations or open documents.
- Existing operational design preserved; supplier, inventory, purchasing and
  receiving screens added to business-v2. Useful placeholders, both scanner
  modes, queued repeated scans, paginated record pickers, totals grouped by unit,
  localized timestamps and RTL/mobile tables are implemented.
- Migration 012 applied only to isolated test PostgreSQL. No legacy data imported,
  production deployment, real charges or external mail.
- Remaining operational services: 11–17. Reservations have a protected balance
  column but no public workflow until POS; movement corrections require the later
  return/adjustment services. Receiving UI explicitly uses base units. Pack input
  is accepted by the API; the dedicated pack UI remains Service 7 work.

Verification for Services 8–10: 127 backend tests passed across the unit/integration
suites (20 HTTP/provider + 107 PostgreSQL integration, including 11 new operations
tests). Source/test typechecks and backend/frontend production builds passed.
Real-API browser flows passed at all five AR/EN widths; the final scanner focus
and mobile input correction was rerun at 320/390/1440. Screenshot review widened
the mobile barcode field and replaced timing-dependent single-scan focus with
a render effect. No browser page errors or page/dialog horizontal overflow.


## Service 11 — transfers and goods in transit

Implemented 2026-11-11. See backend-node/TRANSFERS.md.
- Draft routes require both location assignments; source-authorized dispatch and
  destination-authorized receiving support different employees at each end.
- Atomic dispatch reduces source stock only. Partial arrivals add destination
  stock only. Sent = received + returned + lost + still in transit for each line.
- Managers authorized at both ends can record physical returns or confirmed
  transit losses with required reasons. Events and event lines are append-only
  in PostgreSQL. Closed transfers keep their complete reconciliation/history.
- Client-key idempotency for creation and events, durable dispatch replay,
  revisions/row locks and exact quantities protect concurrent/retried actions.
- Archive guard includes both ends of open transfers. In-flight goods can finish
  after trial expiry/product deactivation; live session/role/location/suspension
  checks still apply. No new dispatch is allowed without active entitlement.
- Bilingual business-v2 list, draft editor, dispatch confirmation, arrival/return/
  loss forms and review dialogs, permanent paginated history and role-based actions.
  Reused existing fields, panels, tables, dialogs, colors and RTL patterns.
- Migration 013 applied only to isolated PostgreSQL; no customer stock, deployment,
  real payments or mail affected. Remaining services are 12–17; Service 7 and
  billing follow-ups remain tracked separately.

Service 11 verification: 140 backend tests passed (120 PostgreSQL integration,
including 13 transfer tests, plus 20 HTTP/provider tests). Source/test typechecks
and backend/frontend production builds passed. Real-API browser flows passed with
separate source/destination employees, manager resolution, stock conservation,
AR/EN 320/390/768/1024/1440 layouts, and arrival review dialogs at 320/390/1440.
Keyboard Escape restores the review button after the dialog close lifecycle;
the browser assertion waits for that lifecycle rather than checking mid-animation.
Screenshots reviewed: Arabic 390px history/arrival form/review and English review.


## Service 12 — Sales / POS

Implemented 2026-11-11. See backend-node/SALES.md.
- Active-shop POS with barcode/search, queued repeated scans, pack/base lines,
  exact quantities, server catalogue pricing and permission-controlled discounts.
- Saved 15-minute drafts can be resumed, revised/repriced or cancelled without
  stock changes. Drafts do not reserve stock. Active drafts block shop archiving.
- Fully paid checkout atomically commits immutable sale/receipt, payment, stock
  ledger and audit. Exact integer math, currency precision, optimistic revisions,
  row locks and durable idempotency prevent rounding errors and duplicate sales.
- Cash change and externally received card/bank payments are recorded; no payment
  processor calls. Noncash payments require exact total and reference.
- Cashiers can operate their own drafts at assigned shops; manager permissions
  control other staff drafts and discounts. Live authorization applies on replay.
  Product lookup and receipt responses never expose internal cost snapshots.
- Arabic/English POS list/editor/review/checkout and authenticated printable
  receipts reuse the existing design. Scanner input was widened on small phones
  during screenshot review; unit prices retain their four-decimal precision.
- Migration 014 applied to test PostgreSQL only. No production changes, real
  charges, customer stock changes, data import or external messages.
- Remaining primary services: 13 returns, 14 counts/damage, 15 payments/daily cash,
  16 dashboard/reports, 17 migration/pilot. Billing and catalogue follow-ups remain.
  Offline sales, tax/fiscal invoices, terminal integration and credit/split payments
  are outside this implementation. Catalogue pack setup UI remains pending.

Service 12 verification: 156 backend tests across the suites (136 PostgreSQL
integration including 16 POS cases, plus 20 HTTP/provider). The full integration
suite passed before the final two POS cases; all 16 POS cases and 20 HTTP/provider
checks passed after the final changes. Source/test/browser-script typechecks and
backend/frontend production builds passed. Real-API Chrome covered owner/cashier,
repeated scans, mixed packs, discounts, cash change, insufficient-stock recovery,
external card records, receipt print media, AR/EN five-width layouts and dialog
focus restoration. Screenshots and baseline references are in tmp/sales-design.


## Services 13–17 — 2026-11-11

User requested all remaining services, then explicitly confirmed: "Prepare locally
first; hosting/data not ready." Production deployment, real-data migration and a
physical staff/device pilot remain pending. No commercial-ready claim is made.

See backend-node/COMPLETION_SERVICES.md and backend-node/ROLLOUT.md.
- Returns reference completed sales/receipts, enforce cumulative base quantities,
  distinguish sellable/damaged goods, allocate exact original-price credits and
  post only with approval. Supplier history includes linked returns.
- Counts capture an immutable-ledger revision before counting and check it again
  on draft save and approval. Same-time/net-zero movements invalidate a snapshot.
  Damage and discrepancies post traceable stock movements atomically.
- Finance records actual partial supplier payments, receipt-specific credits,
  supplier/customer refunds, expenses and drawer additions/withdrawals. Amounts
  cannot exceed due/refundable balances. Payment writes never change stock.
- Daily closing reconciles physical cash in business-local time, requires variance
  explanations, checks refreshed totals, and locks the day against later cash sales
  or entries. Financial activity fixes timezone/currency for reconciliation.
- Reports include current stock/low stock, completed purchases/sales/returns,
  payment entries, supplier balances and customer refund balances, plus estimated
  profit with explicitly stated cost limitations. Filters/export use live tenant,
  location and cost authority. CSV formula prefixes are neutralized.
- Opening-stock preview is owner-only and changes nothing until confirmation.
  Rehearsal posts only to unused product/location pairs. Legacy export analysis
  leaves account credentials and historical writes untouched; base-unit and
  location allocation require deliberate review. Source SHA-256 is retained.
- Automated pilot verifies receive 100, move 30, sell 5, restock-return 2 =>
  warehouse 70 / shop 27 / no transit, with zero ledger differences.
- Local PostgreSQL backup/restore rehearsal passed for all 42 public tables,
  schema version and immutable triggers; only the temporary restored database
  was removed. Production backup policy/restore is not yet tested.
- Migrations 015/016 applied only to isolated test PostgreSQL. Legacy MongoDB,
  customer records, production services, external mail and payment providers were
  not changed. Billing Service 5 and catalogue Service 7 follow-ups remain.

Remaining rollout boundaries: actual hosting/secrets/SMTP, paid subscription
lifecycle, source export completeness, opening liabilities, fiscal requirements,
physical scanners/printers, owner acceptance and cutover. There is no automatic
legacy financial-history/debt importer, cross-receipt credit allocation, payment
reversal, cash-day reopening, FIFO valuation or offline sales. These are stated in
the module guide, not hidden behind a "fully production ready" status.


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


## Five-priority release preparation — 12 November 2026

User reconfirmed local preparation: hosting, domain, PayPal/SMTP and customer data
are not ready. No live deployment, external mail, charge or customer migration.

1. Billing: gated checkout and provider-plan bindings; verified paid-period
   reconciliation, missing-receipt repair, renewal expiry, cancellation-through-period
   and refund/reversal holds. Trials and capacity checks share the entitlement path.
   Actual sandbox, pricing and refund/re-subscription/upgrade policies remain gates.
2. Catalogue: tenant-managed unit/category definitions; normalized private images;
   pack setup/retirement UI; active-pack filtering in new stock/sales entries;
   custom units in imports and operational views. Historical values remain fixed.
3. Deployment: API/web Dockerfiles, same-origin HTTPS proxy, background-job runner,
   heartbeat, GitHub CI, configuration check and encrypted-backup script prepared.
   Docker/age are unavailable locally; container startup and encrypted archive
   execution require the staging environment. External alerting is not configured.
4. Migration/pilot: source-hash/count/allocation review validator and CLI; explicit
   owner evidence references. No invented opening liabilities or imported accounts.
5. Cutover: opt-in B2B-primary frontend disables legacy auth bootstrapping and routes
   the main entry points to new screens. Optional legacy write freeze retains
   history/session access. Real cutover and owner acceptance remain unexecuted.

Verification details are recorded in the final release-check entry below.


### Final release-preparation verification

- 44-table PostgreSQL dump/restore passed with matching counts, current schema and
  immutable-history triggers; the source database was unchanged.
- Backend/frontend production builds and source/test/browser TypeScript checks pass.
- Catalogue browser workflows passed custom-unit setup, product creation, image
  upload, pack creation/retirement, cost privacy and AR/EN at 320/390/768/1024/1440.
- Built B2B-primary mode passed root and legacy-path redirects and asserted no
  legacy API requests. Paid-status layout fixtures passed AR/EN 320/390/1440.
- Two legacy write-freeze tests passed. The offline release-configuration checker
  passed with synthetic values only; no SMTP/provider connection was attempted.
- Backup shell syntax, dependency lock consistency and Git diff whitespace checks
  passed. Secret-pattern scan of publishable files returned no matches.
- Docker images, Caddy HTTPS, GitHub-hosted CI, age encrypted backup execution,
  production SMTP/PayPal, real data and physical devices remain unverified here.

- Final full integration run: 163 tests passed with two fixture workers; 22
  HTTP/provider/migration-review tests passed (185 backend tests total). Explicit
  concurrent transaction/idempotency tests remain enabled. Unlimited fixture
  workers hit the bounded TRANSACTION_BUSY response once; worker concurrency was
  limited instead of weakening production retry or transaction safeguards.
- Final catalogue/import checks were rerun after adding reference validation to
  import preview. Commercial rollout remains blocked by the external gates above.


## Owner onboarding and provider preparation — 13 November 2026

Latest user requirement overrides earlier mandatory-owner-MFA notes: authenticator MFA is optional for business owners, including billing, and is also optional for platform admins. Owners must verify email and a Syrian mobile before using the business workspace. New real-service settings enforce both gates in production; `.env.services` enables them locally with mock codes disabled. Explicit loopback staging uses the same screens with mock code 123456 until credentials arrive.

Implemented encrypted/keyed five-minute email and phone verification challenges, five-attempt limits, resend invalidation, per-IP/account/number quotas, one verified phone per account, MsgPlus SMS outbox/worker, and a one-time bilingual welcome email after owner verification (or staff invitation acceptance). No Jawlaha credentials copied. SMTP is shared by verification, welcome, auth links/invitations and closing reports. Real SMTP/MsgPlus keys, approved sender/template and actual delivery remain external setup gates. See `backend-node/SERVICES_SETUP.md` for exact environment fields and startup/check commands. Migration 20261113110000_owner_verification applied to test and local staging. 38 unit/HTTP tests, 244 integration tests and generated-code browser onboarding passed.

Latest correction, 13 November 2026: MFA enrollment is optional for EVERY role, including SUPER_ADMIN. Enrolled accounts still complete MFA at login; all roles can disable it with password and a valid authenticator code. Earlier mandatory-platform-MFA notes are superseded. Email/phone verification rules are unchanged.

## Five-specialist journey audit — 13 November 2026

Five AI reviewers covered accounting, purchasing/inventory, sales/returns,
closing/report delivery, and authentication/isolation/subscriptions. They were not
human accountants and this is not accounting certification.

Confirmed fixes:
- Editing an order-linked receipt now inherits the approved order price for newly
  added lines rather than silently using catalogue cost. Existing snapshots and
  explicitly authorized cost edits are preserved. Failing-then-passing regression
  in operations.test.ts.
- Partial restock returns now cumulatively allocate the original rounded sale-line
  cost; previously repeated partial returns could invent or lose a cent of profit.
  Regressions cover both rounding directions, report-range additivity and mixed
  damaged/restocked returns in operations-audit.test.ts.
- Public copy was checked against the active B2B app. Credit sales and automatic
  double-entry financial statements are not supported by its current Node routes;
  those legacy marketing promises were replaced with supported operations.

Final backend regression: 251 integration tests across 20 files and 38 unit/HTTP
checks across 7 files passed. Typechecks and frontend production build passed.
Chrome full journey: account/email verification, optional TOTP, trial, warehouse/
shop, cashier invitation/assignment, products, receiving, transfers, sale, customer
return, count/damage, payments/expenses, cash close and report CSV. Reconciled $29
sale, $3 refund, $15 expense, $111 closing cash, 192 stock units, $520 supplier balance.
AR/EN report screens at 320/390/768/1024/1440 passed. Evidence: tmp/full-business-journey.
Recovery browser tests proved committed import/sale retries after response loss and
API restart do not duplicate product/payment/stock writes (tmp/recovery-ui).
Closing reports and required email/Syrian-phone onboarding passed independent Chrome
checks at five widths in both languages (tmp/five-audit-closing-reports and
 tmp/five-audit-contact-onboarding). Harnesses updated for current local ports and
registration phone; return selection now uses product identity, not unstable row order.

Limits: SMTP/SMS captured locally; PayPal simulated, no live settlement tested.
SMTP acceptance followed by worker crash can duplicate notification email; it does
not duplicate financial transactions. A broad purchasing UI pass timed out during
final navigation; fresh supported quick UI pass succeeded. Existing pg concurrent-
query deprecation warnings remain. Do not describe this audit as proving flawless
software or production payment readiness.

## Five-specialist SEO implementation — 13 November 2026

Five AI reviewers covered metadata/Open Graph, structured data, LLM discovery,
technical rendering/crawling, and content semantics. Public Arabic routes remain
unprefixed; English now uses /en, /en/features, /en/pricing and /en/about, with
reciprocal ar/en/x-default alternatives and consistent canonical links.

- Page-specific title/description/OG/Twitter metadata, a real 1200x630 branded PNG,
  and safe truthful Organization/WebSite/WebPage/AboutPage/WebApplication JSON-LD.
  No fake rating, review, price or rich-result eligibility claim was introduced.
- llms.txt and bilingual product-overview.md describe supported features and limits.
  llms.txt is experimental and does not guarantee AI visibility; existing general
  crawler policy was retained, with API crawling disallowed.
- CRA build now renders the actual public React components into eight HTML pages,
  using webpack/Babel already present in the locked dependencies. No browser,
  API, customer state or new external dependency is required for production builds.
- Nginx serves stable public routes, generic noindex account shells and real404s;
  missing assets no longer receive a successful SPA document. Sitemap covers both
  languages, without arbitrary lastmod timestamps.
- SW v5 keeps locale-specific public caches separate, excludes API/private/token
  response caching, and uses only a generic app shell for private offline fallback.
- Native FAQ preserves six answers in initial HTML and works without JavaScript;
  localized metadata and standalone heading hierarchy corrected.

Checks: 5 JSON-LD unit tests; all8localized routes through metadata browserchecks;
raw HTML/schema/sitemap/cache-isolation checks; no-JavaScript Chrome rendering and
FAQ interaction; private/unknown noindex response fixtures; live locale switching.
Evidence: tmp/seo-content, tmp/seo-static, frontend/scripts/check-metadata.mjs,
verify-seo-build.cjs and verify-seo-browser.cjs. See deployment/README.md.

Production domain remains the existing https://profitendo.com. Nginx/Docker binaries
are not installed locally: source/fixture tests do not prove deployed HTTP behavior.
Deploy, verify real headers/share previews, and submit sitemap via verified Google/
Bing webmaster accounts before claiming indexing; no rankings or AI citations are
promised. This work did not deploy or push changes.
