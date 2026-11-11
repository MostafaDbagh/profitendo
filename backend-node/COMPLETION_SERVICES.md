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
expense approval queue or payment reversal workflow is included. Existing posted
records should never be edited to correct a mistake; formal reversal functionality
is a separate follow-up, not a hidden database change.

## 16 — dashboard and reports

Reports include scoped stock, low-stock filtering, completed sales, receiving,
returns, payment entries, supplier outstanding/refund balances and customer refund
balances. The overview shows sales after discounts, return credits, net sales,
expenses and cost-gated estimated profit. Reports use business-local date
boundaries, including DST; exported timestamps retain explicit UTC ISO timestamps.
Current stock and outstanding balances are explicitly all-time/current and ignore
the activity date range.

Estimated profit uses saved sale costs, reverses cost only for sellable customer
returns, and subtracts recorded damage cost and expenses. It excludes tax and
stock-count valuation changes; it is not FIFO or statutory profit reporting.
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
